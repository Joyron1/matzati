// The Google connections the owner sets in /admin/settings ("חיבור לגוגל"): the Google Analytics 4
// measurement id and the Search Console verification token. The owner pastes whatever Google gives
// (the whole gtag.js snippet or the <meta> tag, or only the value): only the id and the token are
// extracted, validated and stored. The pasted text itself is never stored, and nothing pasted is
// ever rendered as HTML or run. Pure, so the admin form shows the same extraction live while typing.
import { z } from "zod";

/** A GA4 measurement id, as stored and as put into the gtag.js URL. */
export const GA4_ID_PATTERN = /^G-[A-Z0-9]{4,12}$/;
/** A Search Console HTML-tag verification token, as stored and as put into the <meta> tag. */
export const GSC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;
/** The longest text a field accepts (the gtag.js snippet is about 400 characters). */
export const GOOGLE_FIELD_MAX = 5000;

/** site_settings.key of the Google Analytics 4 connection. */
export const GOOGLE_ANALYTICS_KEY = "google_analytics";
/** site_settings.key of the Search Console verification. */
export const SEARCH_CONSOLE_KEY = "google_search_console";

export const measurementIdSchema = z.string().regex(GA4_ID_PATTERN);
export const siteVerificationSchema = z.string().regex(GSC_TOKEN_PATTERN);

/** site_settings.value of GOOGLE_ANALYTICS_KEY; null when the owner cleared it. */
export const googleAnalyticsValueSchema = z.object({
  measurementId: measurementIdSchema.nullable(),
});
/** site_settings.value of SEARCH_CONSOLE_KEY; null when the owner cleared it. */
export const searchConsoleValueSchema = z.object({
  verification: siteVerificationSchema.nullable(),
});

/** What the admin's save writes: both connections at once. */
export const googleSettingsInputSchema = z.object({
  measurementId: measurementIdSchema.nullable(),
  siteVerification: siteVerificationSchema.nullable(),
});
export type GoogleSettingsInput = z.infer<typeof googleSettingsInputSchema>;

/** The measurement id a stored value holds, or null (none stored, cleared, or not valid). */
export function measurementIdOf(value: unknown): string | null {
  const parsed = googleAnalyticsValueSchema.safeParse(value);
  return parsed.success ? parsed.data.measurementId : null;
}

/** The verification token a stored value holds, or null (none stored, cleared, or not valid). */
export function siteVerificationOf(value: unknown): string | null {
  const parsed = searchConsoleValueSchema.safeParse(value);
  return parsed.success ? parsed.data.verification : null;
}

/** What a field's text gives: nothing (the connection is removed), a value, or why not. */
export type Extraction =
  { kind: "empty" } | { kind: "found"; value: string } | { kind: "error"; message: string };

const EMPTY: Extraction = { kind: "empty" };
const found = (value: string): Extraction => ({ kind: "found", value });
const error = (message: string): Extraction => ({ kind: "error", message });

export const EXTRACT_ERRORS = {
  tooLong: "הטקסט ארוך מדי (עד 5,000 תווים). הדביקו רק את הקוד שגוגל נותנת.",
  // Latin text stays out of the ends of these sentences' clauses where a neutral character (a
  // hyphen, "://", a quote) would be drawn on the wrong side in right-to-left text.
  gaNotFound: "לא מצאנו מזהה מדידה. מזהה מדידה של Google Analytics 4 נראה כך: G-AB12CD34EF.",
  gaUniversal:
    "זה מזהה של Universal Analytics, שכבר לא פועל. צריך מזהה מדידה של Google Analytics 4, למשל G-AB12CD34EF.",
  gaTagManager:
    "זה קוד של Google Tag Manager. צריך מזהה מדידה של Google Analytics 4, למשל G-AB12CD34EF.",
  gaMany: (ids: string[]) =>
    `מצאנו יותר ממזהה מדידה אחד: ${ids.join(", ")}. הדביקו את הקוד של זרם נתונים אחד בלבד.`,
  gscHtmlFile:
    "זה שם של קובץ אימות. ב־Search Console בחרו בשיטת האימות HTML tag והדביקו את התג שהיא נותנת.",
  gscDns: "זו רשומת DNS. ב־Search Console בחרו בשיטת האימות HTML tag והדביקו את התג שהיא נותנת.",
  gscOtherTag: "התג שהדבקתם הוא לא תג האימות של גוגל. בתג האימות כתוב google-site-verification.",
  gscMany: "מצאנו יותר מתג אימות אחד. הדביקו תג אחד בלבד.",
  gscInvalid:
    "זה לא נראה כמו קוד אימות של Search Console. הדביקו את תג ה־meta כולו, או רק את הערך שב־content.",
} as const;

/** Candidates for a GA4 id: "G-" and 4-12 letters or digits, not inside a longer word. */
const GA_CANDIDATE = /(^|[^A-Za-z0-9_-])G-([A-Za-z0-9]{4,12})(?![A-Za-z0-9_-])/gi;

const unique = (values: string[]) => [...new Set(values)];

/**
 * The GA4 measurement id in what the owner pasted: the gtag.js snippet (which names the id twice),
 * the id alone, or anything else that names exactly one id. Case is normalized to upper case.
 */
export function extractMeasurementId(text: string): Extraction {
  const input = text.trim();
  if (!input) return EMPTY;
  if (input.length > GOOGLE_FIELD_MAX) return error(EXTRACT_ERRORS.tooLong);
  const ids = unique([...input.matchAll(GA_CANDIDATE)].map((m) => `G-${m[2].toUpperCase()}`));
  if (ids.length === 1) return found(ids[0]);
  if (ids.length > 1) return error(EXTRACT_ERRORS.gaMany(ids));
  if (/\bUA-\d{4,}-\d+\b/i.test(input)) return error(EXTRACT_ERRORS.gaUniversal);
  if (/\bGTM-[A-Z0-9]{4,}\b/i.test(input)) return error(EXTRACT_ERRORS.gaTagManager);
  return error(EXTRACT_ERRORS.gaNotFound);
}

/** The value of attribute `name` in one HTML tag's text (quoted either way, or unquoted). */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|[\\s<"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`,
    "i",
  ).exec(tag);
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? "").trim();
}

const VERIFICATION_NAME = "google-site-verification";

/**
 * The Search Console verification token in what the owner pasted: the HTML-tag method's whole
 * <meta name="google-site-verification" content="…"> tag, or the content value alone. The other
 * methods (an HTML file, a DNS record) are named, so the owner knows to pick the tag instead.
 */
export function extractVerificationToken(text: string): Extraction {
  const input = text.trim();
  if (!input) return EMPTY;
  if (input.length > GOOGLE_FIELD_MAX) return error(EXTRACT_ERRORS.tooLong);
  const looksLikeTag = /<\s*meta\b/i.test(input) || /(?:^|\s)content\s*=/i.test(input);
  if (!looksLikeTag && /google[0-9a-f]{12,}\.html/i.test(input)) {
    return error(EXTRACT_ERRORS.gscHtmlFile);
  }
  if (!looksLikeTag && /^google-site-verification\s*[=:]/i.test(input)) {
    return error(EXTRACT_ERRORS.gscDns);
  }
  if (looksLikeTag) {
    const tags = input.match(/<\s*meta\b[^>]*>?/gi) ?? [input];
    const tokens = unique(
      tags
        .filter((tag) => attribute(tag, "name")?.toLowerCase() === VERIFICATION_NAME)
        .map((tag) => attribute(tag, "content") ?? ""),
    );
    if (tokens.length === 0) return error(EXTRACT_ERRORS.gscOtherTag);
    if (tokens.length > 1) return error(EXTRACT_ERRORS.gscMany);
    return GSC_TOKEN_PATTERN.test(tokens[0]) ? found(tokens[0]) : error(EXTRACT_ERRORS.gscInvalid);
  }
  // The value alone, perhaps still in the quotes it was copied with.
  const token = input.replace(/^(["'])(.*)\1$/, "$2").trim();
  return GSC_TOKEN_PATTERN.test(token) ? found(token) : error(EXTRACT_ERRORS.gscInvalid);
}

/** The admin form's fields. */
export const GA_FIELD = "google_analytics";
export const GSC_FIELD = "google_site_verification";

export interface GoogleFormValues {
  /** The text in the GA4 field (the stored id, or what the owner pasted). */
  ga: string;
  /** The text in the Search Console field. */
  gsc: string;
}

/** The "חיבור לגוגל" form's state for useActionState. */
export interface GoogleFormState {
  values: GoogleFormValues;
  errors: { ga?: string; gsc?: string; form?: string };
}

export const GOOGLE_FORM_ERRORS = {
  saveFailed: "לא הצלחנו לשמור את החיבור לגוגל. נסו שוב בעוד רגע.",
} as const;

/**
 * The submitted form as the values to store, or the form again with a message per field. An
 * empty field is a cleared connection (null).
 */
export function parseGoogleForm(
  formData: FormData,
): { ok: true; value: GoogleSettingsInput } | { ok: false; state: GoogleFormState } {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const values: GoogleFormValues = { ga: text(GA_FIELD), gsc: text(GSC_FIELD) };
  const ga = extractMeasurementId(values.ga);
  const gsc = extractVerificationToken(values.gsc);
  if (ga.kind === "error" || gsc.kind === "error") {
    return {
      ok: false,
      state: {
        values,
        errors: {
          ...(ga.kind === "error" ? { ga: ga.message } : {}),
          ...(gsc.kind === "error" ? { gsc: gsc.message } : {}),
        },
      },
    };
  }
  return {
    ok: true,
    value: {
      measurementId: ga.kind === "found" ? ga.value : null,
      siteVerification: gsc.kind === "found" ? gsc.value : null,
    },
  };
}
