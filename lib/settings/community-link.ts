// The "join our community" link the owner sets in /admin/settings ("קישור לקהילה"): the stored
// shape, the checks on the URL and the button label, and the admin form. Pure (the admin form uses
// the same checks); the cached read is ./community.ts (getCommunityLink), the write ./admin.ts.
import { z } from "zod";

/** site_settings.key of the community link. */
export const COMMUNITY_KEY = "community_link";

export const DEFAULT_COMMUNITY_LABEL = "הצטרפו לקהילה שלנו";
export const COMMUNITY_URL_MAX = 500;
export const COMMUNITY_LABEL_MIN = 2;
export const COMMUNITY_LABEL_MAX = 40;

/** What the footer shows: the button's link and label. */
export interface CommunityLink {
  /** https URL of the community (e.g. a WhatsApp or Telegram invite). */
  url: string;
  /** Button label, e.g. "הצטרפו לקהילה שלנו". */
  label: string;
}

export const COMMUNITY_ERRORS = {
  urlTooLong: `הקישור ארוך מדי (עד ${COMMUNITY_URL_MAX} תווים).`,
  // "https" without "://": those characters would be drawn on the wrong side in Hebrew text.
  urlInvalid: "זו לא כתובת תקינה. העתיקו את הקישור המלא, שמתחיל ב־https.",
  urlNotHttps: "הקישור חייב להתחיל ב־https.",
  urlCredentials: "קישור עם שם משתמש או סיסמה לא נתמך.",
  urlRequired: "כדי להציג את הכפתור באתר צריך קישור.",
  labelShort: `הטקסט על הכפתור קצר מדי (לפחות ${COMMUNITY_LABEL_MIN} תווים).`,
  labelLong: `הטקסט על הכפתור ארוך מדי (עד ${COMMUNITY_LABEL_MAX} תווים).`,
  saveFailed: "לא הצלחנו לשמור את קישור הקהילה. נסו שוב בעוד רגע.",
} as const;

export type UrlCheck = { ok: true; url: string | null } | { ok: false; message: string };

/**
 * The link as it will be stored (normalized by the URL parser), null for an empty field, or why it
 * cannot be used: https only, a host name with a dot, no user name or password, no spaces.
 */
export function checkCommunityUrl(text: string): UrlCheck {
  const input = text.trim();
  if (!input) return { ok: true, url: null };
  if (input.length > COMMUNITY_URL_MAX) return { ok: false, message: COMMUNITY_ERRORS.urlTooLong };
  if (/\s/.test(input)) return { ok: false, message: COMMUNITY_ERRORS.urlInvalid };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      ok: false,
      message: /^[a-z][a-z0-9+.-]*:/i.test(input)
        ? COMMUNITY_ERRORS.urlInvalid
        : COMMUNITY_ERRORS.urlNotHttps,
    };
  }
  if (url.protocol !== "https:") return { ok: false, message: COMMUNITY_ERRORS.urlNotHttps };
  if (url.username || url.password) return { ok: false, message: COMMUNITY_ERRORS.urlCredentials };
  const host = url.hostname;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) {
    return { ok: false, message: COMMUNITY_ERRORS.urlInvalid };
  }
  if (url.href.length > COMMUNITY_URL_MAX)
    return { ok: false, message: COMMUNITY_ERRORS.urlTooLong };
  return { ok: true, url: url.href };
}

/** A stored URL is valid when checking it again gives it back unchanged. */
function isStoredUrl(url: string): boolean {
  const check = checkCommunityUrl(url);
  return check.ok && check.url === url;
}

/**
 * Control characters, and the bidi embedding, override and isolate characters (U+202A-U+202E,
 * U+2066-U+2069), which would let a label change how the footer around it reads.
 */
function isControl(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** The label as stored: control characters removed, spaces collapsed, trimmed. */
export function normalizeCommunityLabel(text: string): string {
  const kept = [...text].filter((ch) => !isControl(ch.codePointAt(0) ?? 0)).join("");
  return kept.replace(/\s+/g, " ").trim();
}

export const communityValueSchema = z
  .object({
    url: z.string().refine(isStoredUrl).nullable(),
    label: z
      .string()
      .min(COMMUNITY_LABEL_MIN)
      .max(COMMUNITY_LABEL_MAX)
      .refine((label) => label === normalizeCommunityLabel(label)),
    enabled: z.boolean(),
  })
  .refine((value) => !value.enabled || value.url !== null, { path: ["url"] });

/** site_settings.value of COMMUNITY_KEY. */
export type CommunityValue = z.infer<typeof communityValueSchema>;

/** Nothing stored yet: no link, the default label, hidden. */
export const DEFAULT_COMMUNITY_VALUE: CommunityValue = {
  url: null,
  label: DEFAULT_COMMUNITY_LABEL,
  enabled: false,
};

/** The stored value, or null when it is not a community setting (a hand-edited row). */
export function communityValueOf(value: unknown): CommunityValue | null {
  const parsed = communityValueSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The button the footer shows for a stored value: only when it is switched on and has a link. */
export function communityLinkOf(value: unknown): CommunityLink | null {
  const stored = communityValueOf(value);
  if (!stored || !stored.enabled || stored.url === null) return null;
  return { url: stored.url, label: stored.label };
}

/** The admin form's fields. */
export const COMMUNITY_URL_FIELD = "community_url";
export const COMMUNITY_LABEL_FIELD = "community_label";
export const COMMUNITY_ENABLED_FIELD = "community_enabled";

export interface CommunityFormValues {
  url: string;
  label: string;
  enabled: boolean;
}

/** The "קישור לקהילה" form's state for useActionState. */
export interface CommunityFormState {
  values: CommunityFormValues;
  errors: { url?: string; label?: string; form?: string };
}

/** The form's values for a stored setting. */
export function communityFormValues(value: CommunityValue): CommunityFormValues {
  return { url: value.url ?? "", label: value.label, enabled: value.enabled };
}

/** The submitted form as the value to store, or the form again with a message per field. */
export function parseCommunityForm(
  formData: FormData,
): { ok: true; value: CommunityValue } | { ok: false; state: CommunityFormState } {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const values: CommunityFormValues = {
    url: text(COMMUNITY_URL_FIELD),
    label: text(COMMUNITY_LABEL_FIELD),
    enabled: formData.get(COMMUNITY_ENABLED_FIELD) === "on",
  };
  const errors: CommunityFormState["errors"] = {};
  const url = checkCommunityUrl(values.url);
  if (!url.ok) errors.url = url.message;
  else if (values.enabled && url.url === null) errors.url = COMMUNITY_ERRORS.urlRequired;
  const label = normalizeCommunityLabel(values.label) || DEFAULT_COMMUNITY_LABEL;
  if (label.length < COMMUNITY_LABEL_MIN) errors.label = COMMUNITY_ERRORS.labelShort;
  else if (label.length > COMMUNITY_LABEL_MAX) errors.label = COMMUNITY_ERRORS.labelLong;
  if (!url.ok || errors.url || errors.label) return { ok: false, state: { values, errors } };
  return { ok: true, value: { url: url.url, label, enabled: values.enabled } };
}
