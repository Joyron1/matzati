// The Meta connection the owner sets in /admin/settings ("חיבור ל־Meta (פייסבוק ואינסטגרם)"): the
// Meta Pixel id (a dataset id in Events Manager). The owner pastes whatever Meta gives (the whole
// base code with fbq('init', '…'), or only the id): only the id is extracted, validated and
// stored. The pasted text itself is never stored, and nothing pasted is ever rendered as HTML or
// run (advanced matching data in a pasted init call is ignored: we never send any). Pure, so the
// admin form shows the same extraction live while typing.
import { z } from "zod";
import type { Extraction } from "./google";

/** A Meta Pixel id, as stored and as put into fbq('init'). */
export const META_PIXEL_ID_PATTERN = /^\d{10,20}$/;
/** The longest text the field accepts (the base code is about 900 characters). */
export const META_FIELD_MAX = 5000;

/** site_settings.key of the Meta Pixel connection. */
export const META_PIXEL_KEY = "meta_pixel";

export const pixelIdSchema = z.string().regex(META_PIXEL_ID_PATTERN);

/** site_settings.value of META_PIXEL_KEY; null when the owner cleared it. */
export const metaPixelValueSchema = z.object({ pixelId: pixelIdSchema.nullable() });
export type MetaPixelValue = z.infer<typeof metaPixelValueSchema>;

/** The pixel id a stored value holds, or null (none stored, cleared, or not valid). */
export function pixelIdOf(value: unknown): string | null {
  const parsed = metaPixelValueSchema.safeParse(value);
  return parsed.success ? parsed.data.pixelId : null;
}

export const META_EXTRACT_ERRORS = {
  tooLong: "הטקסט ארוך מדי (עד 5,000 תווים). הדביקו רק את הקוד ש־Meta נותנת, או רק את המזהה.",
  notFound:
    "לא מצאנו מזהה פיקסל. מזהה פיקסל של Meta הוא מספר של 10 עד 20 ספרות, למשל 1234567890123456.",
  many: (ids: string[]) =>
    `מצאנו יותר ממזהה פיקסל אחד: ${ids.join(", ")}. הדביקו את הקוד של פיקסל אחד בלבד.`,
  accessToken:
    "זה נראה כמו אסימון גישה (access token), לא כמו מזהה פיקסל. אל תדביקו כאן אסימונים: צריך רק את מזהה הפיקסל, מספר של 10 עד 20 ספרות.",
} as const;

const EMPTY: Extraction = { kind: "empty" };
const found = (value: string): Extraction => ({ kind: "found", value });
const error = (message: string): Extraction => ({ kind: "error", message });

/** fbq('init', '<id>') in the base code (quoted either way, or a bare number). */
const INIT_CALL = /fbq\s*\(\s*["']init["']\s*,\s*["']?\s*(\d+)\s*["']?/gi;
/** The <noscript> image of the base code: https://www.facebook.com/tr?id=<id>&ev=PageView. */
const TR_IMAGE = /facebook\.com\/tr\/?\?(?:[^"'\s>]*&(?:amp;)?)?id=(\d+)/gi;

const unique = (values: string[]) => [...new Set(values)];

/**
 * The Meta Pixel id in what the owner pasted: the whole base code (which names the id twice), the
 * id alone (perhaps in the quotes it was copied with), or anything else that names exactly one id.
 */
export function extractPixelId(text: string): Extraction {
  const input = text.trim();
  if (!input) return EMPTY;
  if (input.length > META_FIELD_MAX) return error(META_EXTRACT_ERRORS.tooLong);
  // A Graph API access token starts with "EAA": never something to paste into a site setting.
  if (/(^|[^A-Za-z0-9])EAA[A-Za-z0-9]{20,}/.test(input))
    return error(META_EXTRACT_ERRORS.accessToken);
  const ids = unique([
    ...[...input.matchAll(INIT_CALL)].map((m) => m[1]),
    ...[...input.matchAll(TR_IMAGE)].map((m) => m[1]),
  ]);
  if (ids.length > 1) return error(META_EXTRACT_ERRORS.many(ids));
  if (ids.length === 1) {
    return META_PIXEL_ID_PATTERN.test(ids[0]) ? found(ids[0]) : error(META_EXTRACT_ERRORS.notFound);
  }
  // The id alone, perhaps still in quotes, perhaps with spaces a copy added between digit groups.
  const bare = input.replace(/^(["'])(.*)\1$/, "$2").replace(/\s+/g, "");
  return META_PIXEL_ID_PATTERN.test(bare) ? found(bare) : error(META_EXTRACT_ERRORS.notFound);
}

/** The admin form's field. */
export const META_PIXEL_FIELD = "meta_pixel";

/** The "חיבור ל־Meta" form's state for useActionState. */
export interface MetaFormState {
  values: { pixel: string };
  errors: { pixel?: string; form?: string };
}

export const META_FORM_ERRORS = {
  saveFailed: "לא הצלחנו לשמור את החיבור ל־Meta. נסו שוב בעוד רגע.",
} as const;

/**
 * The submitted form as the value to store, or the form again with the field's message. An empty
 * field is a cleared connection (null).
 */
export function parseMetaForm(
  formData: FormData,
): { ok: true; value: MetaPixelValue } | { ok: false; state: MetaFormState } {
  const raw = formData.get(META_PIXEL_FIELD);
  const pixel = typeof raw === "string" ? raw : "";
  const result = extractPixelId(pixel);
  if (result.kind === "error") {
    return { ok: false, state: { values: { pixel }, errors: { pixel: result.message } } };
  }
  return { ok: true, value: { pixelId: result.kind === "found" ? result.value : null } };
}
