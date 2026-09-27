// Validation for SEO landing pages: the SeoPageInput contract (checked again right before every
// write) and the admin form on top of it. Pure and client-safe, with Hebrew messages the form
// shows next to each field.
import { z } from "zod";
import type { SeoPage, SeoPageInput } from "./db";
import { isValidSlug, normalizeSlugInput, SLUG_MAX_LENGTH, slugFromQuery } from "./slug";

/** Same limit as a visitor's search (MAX_QUERY_LENGTH in lib/search/pipeline.ts). */
export const QUERY_MAX = 200;
export const TITLE_MIN = 3;
/** Search results show about 60 characters of a title; " | מצאתי" is added to it. */
export const TITLE_MAX = 70;
export const INTRO_MAX = 600;

export const SEO_ERRORS = {
  query: `כתבו את החיפוש שימלא את הדף, עד ${QUERY_MAX} תווים.`,
  title: `כתבו כותרת באורך ${TITLE_MIN} עד ${TITLE_MAX} תווים.`,
  intro: `הפתיח ארוך מדי. אפשר עד ${INTRO_MAX} תווים.`,
  slug: `הכתובת יכולה להכיל אותיות בעברית, אותיות באנגלית, ספרות ומקפים, עד ${SLUG_MAX_LENGTH} תווים.`,
  slugFromQuery: "לא הצלחנו ליצור כתובת מהחיפוש. כתבו כתובת בעצמכם.",
  slugTaken: "כבר יש דף עם הכתובת הזאת. בחרו כתובת אחרת.",
} as const;

export const seoInputSchema = z.object({
  slug: z.string(SEO_ERRORS.slug).refine(isValidSlug, SEO_ERRORS.slug),
  query: z
    .string(SEO_ERRORS.query)
    .trim()
    .min(1, SEO_ERRORS.query)
    .max(QUERY_MAX, SEO_ERRORS.query),
  title_he: z
    .string(SEO_ERRORS.title)
    .trim()
    .min(TITLE_MIN, SEO_ERRORS.title)
    .max(TITLE_MAX, SEO_ERRORS.title),
  intro_he: z
    .string(SEO_ERRORS.intro)
    .trim()
    .max(INTRO_MAX, SEO_ERRORS.intro)
    .nullable()
    .transform((s) => (s ? s : null)),
  published: z.boolean(),
});

export type SeoField = keyof SeoPageInput;
/** First message per field; `form` is for problems that belong to no single field. */
export type SeoFieldErrors = Partial<Record<SeoField | "form", string>>;

export type SeoValidation =
  { ok: true; input: SeoPageInput } | { ok: false; errors: SeoFieldErrors };

/** Validates and normalizes a SeoPageInput (trimmed text, empty intro as null). */
export function validateSeoInput(input: unknown): SeoValidation {
  const parsed = seoInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, input: parsed.data };
  const errors: SeoFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    const field =
      typeof key === "string" && key in seoInputSchema.shape ? (key as SeoField) : "form";
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** What the admin typed, echoed back so a rejected form keeps its values. */
export interface SeoFormValues {
  query: string;
  title_he: string;
  intro_he: string;
  /** Empty means "build it from the query". */
  slug: string;
  published: boolean;
}

/** useActionState state of the admin form. */
export interface SeoFormState {
  values: SeoFormValues;
  errors: SeoFieldErrors;
}

export function readSeoFormValues(formData: FormData): SeoFormValues {
  const text = (field: Exclude<keyof SeoFormValues, "published">) => {
    const raw = formData.get(field);
    return typeof raw === "string" ? raw : "";
  };
  return {
    query: text("query"),
    title_he: text("title_he"),
    intro_he: text("intro_he"),
    slug: text("slug"),
    published: formData.get("published") === "on",
  };
}

/**
 * Initial form values: an existing page, or a new one prefilled from ?q= (the stats dashboard
 * links popular searches to /admin/seo/new?q=...). A new page starts as a draft.
 */
export function seoFormValues(page: SeoPage | null, prefillQuery = ""): SeoFormValues {
  if (page) {
    return {
      query: page.query,
      title_he: page.title_he,
      intro_he: page.intro_he ?? "",
      slug: page.slug,
      published: page.published,
    };
  }
  const query = prefillQuery.trim().slice(0, QUERY_MAX);
  return {
    query,
    title_he: query.slice(0, TITLE_MAX),
    intro_he: "",
    slug: slugFromQuery(query),
    published: false,
  };
}

/**
 * Admin form → SeoPageInput. An empty slug is built from the query; a typed one is lightly
 * normalized (normalizeSlugInput) and must then be a valid slug.
 */
export function parseSeoForm(values: SeoFormValues): SeoValidation {
  const typed = normalizeSlugInput(values.slug);
  const slug = typed || slugFromQuery(values.query);
  const result = validateSeoInput({
    slug,
    query: values.query,
    title_he: values.title_he,
    intro_he: values.intro_he,
    published: values.published,
  });
  if (result.ok || typed || !result.errors.slug) return result;
  // The slug was left for us to build and we could not. Without a query, the query error already
  // says what to do (the slug follows it); otherwise say so instead of "invalid slug".
  if (!values.query.trim()) {
    const errors = { ...result.errors };
    delete errors.slug;
    return { ok: false, errors };
  }
  return { ok: false, errors: { ...result.errors, slug: SEO_ERRORS.slugFromQuery } };
}
