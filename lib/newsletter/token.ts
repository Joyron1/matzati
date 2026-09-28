// Unsubscribe tokens: 32 random bytes (256 bits) from the operating system's CSPRNG, base64url
// (43 characters, no padding). One per subscriber, stored in newsletter_subscribers
// (unique, checked by the same pattern) and put in the unsubscribe link of every message. Unguessable,
// so the link needs no sign-in; it only ever unsubscribes, and the page never shows the address.
import { randomBytes } from "node:crypto";
import { absoluteUrl } from "@/lib/config/site";

export const UNSUBSCRIBE_TOKEN_BYTES = 32;

/** base64url of 32 bytes. The migration checks the same pattern. */
export const UNSUBSCRIBE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const UNSUBSCRIBE_PATH = "/newsletter/unsubscribe";

/** A new token. `random` is for tests only. */
export function newUnsubscribeToken(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(UNSUBSCRIBE_TOKEN_BYTES);
  if (bytes.length !== UNSUBSCRIBE_TOKEN_BYTES) throw new Error("wrong number of random bytes");
  return bytes.toString("base64url");
}

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && UNSUBSCRIBE_TOKEN_PATTERN.test(value);
}

/** The unsubscribe page for a token (relative). The page asks to confirm before it unsubscribes. */
export function unsubscribePath(token: string): string {
  return `${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}

/** The link to put in a message (absolute, on the production host). */
export function unsubscribeUrl(token: string): string {
  return absoluteUrl(unsubscribePath(token));
}
