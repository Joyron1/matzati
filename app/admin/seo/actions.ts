"use server";
// Admin mutations for SEO landing pages. Every action checks requireAdmin() itself: actions are
// reachable by a direct POST, so the guarded /admin layout is not enough. Inputs are validated
// here and again in saveSeoPage() right before the service-role write.
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import {
  deleteSeoPage,
  SEO_TAG,
  SeoPageNotFoundError,
  SeoSlugTakenError,
  SeoValidationError,
  saveSeoPage,
} from "@/lib/seo/queries";
import { parseSeoForm, readSeoFormValues, SEO_ERRORS, type SeoFormState } from "@/lib/seo/schema";
import { isValidSlug } from "@/lib/seo/slug";

const MISSING_PAGE = "הדף הזה כבר לא קיים. אולי הוא נמחק בחלון אחר.";
const SAVE_FAILED = "לא הצלחנו לשמור את הדף. נסו שוב בעוד רגע.";

function logError(where: string, err: unknown) {
  // Name and message only. Our errors name missing env keys, never their values.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-seo] ${where}: ${text.slice(0, 300)}`);
}

/**
 * Everything that shows landing pages: the pages themselves (old and new slug on a rename), the
 * sitemap, the home "חיפושים פופולריים" list and the admin list.
 */
function revalidateSeo(slugs: string[]) {
  updateTag(SEO_TAG);
  for (const slug of new Set(slugs)) revalidatePath(`/s/${slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/");
  revalidatePath("/admin/seo");
}

/**
 * Creates (originalSlug null) or updates a landing page from the admin form, for useActionState.
 * Bound with the original slug by the form. On success it redirects to /admin/seo; otherwise it
 * returns the typed values with Hebrew errors so the form keeps what the admin wrote.
 */
export async function saveSeoPageAction(
  originalSlug: string | null,
  _prev: SeoFormState,
  formData: FormData,
): Promise<SeoFormState> {
  await requireAdmin();
  const values = readSeoFormValues(formData);
  if (originalSlug !== null && !isValidSlug(originalSlug)) {
    return { values, errors: { form: MISSING_PAGE } };
  }

  const parsed = parseSeoForm(values);
  if (!parsed.ok) return { values, errors: parsed.errors };

  try {
    await saveSeoPage(parsed.input, originalSlug ?? undefined);
  } catch (err) {
    if (err instanceof SeoValidationError) return { values, errors: err.errors };
    if (err instanceof SeoSlugTakenError) return { values, errors: { slug: SEO_ERRORS.slugTaken } };
    if (err instanceof SeoPageNotFoundError) return { values, errors: { form: MISSING_PAGE } };
    logError("save", err);
    return { values, errors: { form: SAVE_FAILED } };
  }
  revalidateSeo(originalSlug ? [originalSlug, parsed.input.slug] : [parsed.input.slug]);
  redirect(`/admin/seo?status=${originalSlug === null ? "created" : "updated"}`);
}

export interface SeoRowActionState {
  error: string | null;
}

/** Deletes a landing page after the confirm step in the admin list. Bound with the slug. */
export async function deleteSeoPageAction(slug: string): Promise<SeoRowActionState> {
  await requireAdmin();
  if (!isValidSlug(slug)) return { error: MISSING_PAGE };
  try {
    await deleteSeoPage(slug);
  } catch (err) {
    logError("delete", err);
    return { error: "לא הצלחנו למחוק את הדף. נסו שוב בעוד רגע." };
  }
  revalidateSeo([slug]);
  redirect("/admin/seo?status=deleted");
}
