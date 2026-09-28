// Newsletter sign-up (owner request 2026-09-28): the consent text and its version, the form's
// fields, and the form's states and messages. Client-safe (no server imports): the footer form
// renders from here, and the server action stores exactly this text with every sign-up.
import { BRAND } from "@/lib/config/brand";

/**
 * The consent checkbox's label, in the owner's wording. The Communications Law (§30A) requires
 * explicit consent before advertising messages are sent: the box is unchecked by default, and
 * every sign-up row stores this exact text and NEWSLETTER_CONSENT_VERSION. Changing the text
 * (a rename of the brand it names too) is a new version: bump NEWSLETTER_CONSENT_VERSION with it.
 */
export const NEWSLETTER_CONSENT_TEXT = `אני מסכים/ה לקבל מ״${BRAND.name}״ עדכונים על מבצעים וקופונים באימייל. אפשר להסיר את ההרשמה בכל עת.`;

/** Stored with every sign-up (newsletter_subscribers.consent_version): the day the text was set. */
export const NEWSLETTER_CONSENT_VERSION = "2026-09-28";

/** Where a sign-up came from (newsletter_subscribers.source). Only the footer form today. */
export const NEWSLETTER_SOURCES = ["footer"] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

/** How the admin list names each source. */
export const NEWSLETTER_SOURCE_LABELS: Record<NewsletterSource, string> = {
  footer: "תחתית האתר",
};

/** Field names of the sign-up form. */
export const NEWSLETTER_FIELDS = {
  email: "email",
  consent: "consent",
  source: "source",
  /**
   * The honeypot: a text field people never see or reach (visually hidden, aria-hidden, out of
   * the tab order). A submission that fills it is a bot's: it gets the success answer and
   * nothing is counted or stored.
   */
  honeypot: "website",
} as const;

/** The checkbox's value when checked. */
export const NEWSLETTER_CONSENT_VALUE = "yes";

/** The /privacy section about the newsletter (its id is "newsletter"). */
export const NEWSLETTER_PRIVACY_HREF = "/privacy#newsletter";

/** The longest address we accept (RFC 5321 path limit). */
export const NEWSLETTER_EMAIL_MAX = 254;

export type NewsletterStatus =
  "idle" | "subscribed" | "invalid_email" | "consent_required" | "rate_limited" | "unavailable";

/** The form's state for useActionState (also rendered without JavaScript, from the server). */
export interface NewsletterFormState {
  status: NewsletterStatus;
  /** The Hebrew message for the status ("" while idle). */
  message: string;
  /** What the visitor typed, so a rejected submission keeps it in the field. */
  email: string;
  /** Whether the consent box was checked in the rejected submission. */
  consent: boolean;
}

/**
 * The messages. "subscribed" is the answer to every accepted submission, a new address, one that
 * was already subscribed or a bot's alike, so the form never reveals who is on the list.
 */
export const NEWSLETTER_MESSAGES: Record<Exclude<NewsletterStatus, "idle">, string> = {
  subscribed: "תודה, נרשמתם! נעדכן אתכם באימייל על מבצעים וקופונים.",
  invalid_email: "כתובת האימייל לא נראית תקינה. בדקו אותה ונסו שוב.",
  consent_required: "כדי להירשם, סמנו את תיבת ההסכמה לקבלת עדכונים באימייל.",
  rate_limited: "היו יותר מדי הרשמות מהחיבור הזה היום. נסו שוב מחר.",
  unavailable: "לא הצלחנו לרשום אתכם כרגע. נסו שוב בעוד כמה דקות.",
};

export const NEWSLETTER_IDLE: NewsletterFormState = {
  status: "idle",
  message: "",
  email: "",
  consent: false,
};

/** The state for a status; a success clears the fields. */
export function newsletterState(
  status: NewsletterStatus,
  fields: { email?: string; consent?: boolean } = {},
): NewsletterFormState {
  if (status === "idle") return NEWSLETTER_IDLE;
  if (status === "subscribed") {
    return { status, message: NEWSLETTER_MESSAGES.subscribed, email: "", consent: false };
  }
  return {
    status,
    message: NEWSLETTER_MESSAGES[status],
    email: fields.email ?? "",
    consent: fields.consent ?? false,
  };
}
