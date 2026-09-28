// Validation of the newsletter sign-up form (zod). Pure and client-safe: the server action decides
// with it, and the dev preview's stand-in action answers with the same rules.
import { z } from "zod";
import {
  NEWSLETTER_CONSENT_VALUE,
  NEWSLETTER_EMAIL_MAX,
  NEWSLETTER_FIELDS,
  NEWSLETTER_SOURCES,
  type NewsletterSource,
} from "./consent";

/**
 * A trimmed, lowercased address. On top of zod's email rule: at most 64 characters before the @,
 * and the address starts with a letter, a digit or "_", so no stored address can start a formula
 * in a spreadsheet (the CSV export neutralizes such cells too).
 */
export const newsletterEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(NEWSLETTER_EMAIL_MAX)
  .pipe(z.email())
  .refine((email) => /^[a-z0-9_]/.test(email), "starts with a symbol")
  .refine((email) => email.indexOf("@") <= 64, "local part too long");

const sourceSchema = z.enum(NEWSLETTER_SOURCES).catch("footer");

export type ParsedSignup =
  /** The honeypot was filled: answer as if subscribed, count and store nothing. */
  | { kind: "bot" }
  | {
      kind: "invalid";
      status: "invalid_email" | "consent_required";
      /** What was typed (trimmed), to put back in the field. */
      email: string;
      consent: boolean;
    }
  | { kind: "ok"; email: string; source: NewsletterSource };

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/** Reads the submitted form. The email is checked before the consent (the order of the fields). */
export function parseSignupForm(formData: FormData): ParsedSignup {
  if (text(formData.get(NEWSLETTER_FIELDS.honeypot)).trim()) return { kind: "bot" };

  const rawEmail = text(formData.get(NEWSLETTER_FIELDS.email));
  const consent = formData.get(NEWSLETTER_FIELDS.consent) === NEWSLETTER_CONSENT_VALUE;
  // Echoed back into the field only, never stored: cut to the field's own maximum.
  const typed = rawEmail.trim().slice(0, NEWSLETTER_EMAIL_MAX);

  const email = newsletterEmailSchema.safeParse(rawEmail);
  if (!email.success) return { kind: "invalid", status: "invalid_email", email: typed, consent };
  if (!consent) return { kind: "invalid", status: "consent_required", email: typed, consent };

  return {
    kind: "ok",
    email: email.data,
    source: sourceSchema.parse(formData.get(NEWSLETTER_FIELDS.source)),
  };
}
