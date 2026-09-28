// The newsletter sign-up and unsubscribe, with their environment as arguments so they run in unit
// tests with fakes (lib/newsletter/actions.ts binds them to the request, the service-role client
// and the env). Nothing here logs an address, an IP or a token.
import type { DeployEnv } from "@/lib/env";
import { clientIp, hashIp } from "@/lib/guard/rate-limit";
import {
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_CONSENT_VERSION,
  newsletterState,
  type NewsletterFormState,
} from "./consent";
import { unsubscribeByToken, upsertSubscriber, type NewsletterClient } from "./db";
import { allowNewsletterSignup } from "./rate-limit";
import { parseSignupForm } from "./schema";
import { isUnsubscribeToken, newUnsubscribeToken } from "./token";

export interface NewsletterDeps {
  /** The service-role client, created only once a submission needs the database. */
  db: () => NewsletterClient;
  /** The request headers (the client IP for the rate limit). */
  headers: Headers;
  /** IP_HASH_SALT. Empty refuses every sign-up (an unsalted IP hash is reversible). */
  salt: string;
  now: Date;
  env: DeployEnv;
  /** For tests; defaults to a new random token. */
  newToken?: () => string;
  /** Error lines for the server log (name and message only). */
  log?: (text: string) => void;
}

function describe(err: unknown): string {
  // Name and message only: our errors name the operation, never a value.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 300);
}

const defaultLog = (text: string) => console.error(`[newsletter] ${text}`);

/**
 * One sign-up from the form. In order: the honeypot (a bot gets the success answer, nothing is
 * counted or stored), the email and the consent (zod; rejected before anything is counted), the
 * per-IP daily limit (fails closed when the counter cannot be reached), then the idempotent write.
 * A new address, one already subscribed and a bot all get the same answer.
 */
export async function subscribe(
  formData: FormData,
  deps: NewsletterDeps,
): Promise<NewsletterFormState> {
  const log = deps.log ?? defaultLog;
  const parsed = parseSignupForm(formData);
  if (parsed.kind === "bot") return newsletterState("subscribed");
  if (parsed.kind === "invalid") {
    return newsletterState(parsed.status, { email: parsed.email, consent: parsed.consent });
  }
  const keep = { email: parsed.email, consent: true };

  if (!deps.salt.trim()) {
    log("IP_HASH_SALT is not set");
    return newsletterState("unavailable", keep);
  }
  let db: NewsletterClient;
  try {
    db = deps.db();
    const ipHash = hashIp(clientIp(deps.headers), deps.salt);
    if (!(await allowNewsletterSignup(db, ipHash, deps.now, deps.env))) {
      return newsletterState("rate_limited", keep);
    }
  } catch (err) {
    log(`rate limit: ${describe(err)}`);
    return newsletterState("unavailable", keep);
  }

  try {
    await upsertSubscriber(db, {
      email: parsed.email,
      consentText: NEWSLETTER_CONSENT_TEXT,
      consentVersion: NEWSLETTER_CONSENT_VERSION,
      source: parsed.source,
      token: (deps.newToken ?? newUnsubscribeToken)(),
    });
  } catch (err) {
    log(`subscribe: ${describe(err)}`);
    return newsletterState("unavailable", keep);
  }
  return newsletterState("subscribed");
}

/** What the unsubscribe page shows after the confirm button. */
export type UnsubscribeOutcome = "done" | "invalid" | "error";

/**
 * The unsubscribe page's confirm button. "done" also for a token that had already unsubscribed
 * (pressing it twice is fine); "invalid" for a malformed or unknown token; "error" when the
 * database fails (the page offers the button again).
 */
export async function unsubscribe(
  formData: FormData,
  deps: Pick<NewsletterDeps, "db" | "log">,
): Promise<UnsubscribeOutcome> {
  const token = formData.get("token");
  if (!isUnsubscribeToken(token)) return "invalid";
  try {
    const result = await unsubscribeByToken(deps.db(), token);
    return result === "unknown" ? "invalid" : "done";
  } catch (err) {
    (deps.log ?? defaultLog)(`unsubscribe: ${describe(err)}`);
    return "error";
  }
}
