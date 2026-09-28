// Newsletter sign-ups per IP: NEWSLETTER_SIGNUPS_PER_DAY per Israel calendar day, counted on the
// salted IP hash of lib/guard/rate-limit.ts (hashIp; the raw IP is never stored) by
// public.bump_counter under the key "nl:<hash>". Outside production the key gets its env's prefix
// ("dev:nl:<hash>"), like the search counters, so a dev or preview run never uses up a visitor's
// quota. The retention job deletes the rows 48 hours after the day ends (a day-window key:
// supabase/migrations/20260928200000_retention.sql).
import type { SupabaseClient } from "@supabase/supabase-js";
import { deployEnv, type DeployEnv } from "@/lib/env";
import { GuardUnavailableError, israelDayWindow } from "@/lib/guard/rate-limit";

export const NEWSLETTER_SIGNUPS_PER_DAY = 5;

/** Same prefixes as the search counters (COUNTER_PREFIX in lib/guard/rate-limit.ts). */
const ENV_PREFIX: Record<DeployEnv, string> = {
  production: "",
  preview: "preview:",
  development: "dev:",
};

/** The rate_limits key of an IP hash. */
export function newsletterRateKey(ipHash: string, env: DeployEnv): string {
  return `${ENV_PREFIX[env]}nl:${ipHash}`;
}

/**
 * Counts one sign-up for this IP hash today and returns whether it is within the limit.
 * Throws GuardUnavailableError when the database fails (the action then refuses: fail closed).
 */
export async function allowNewsletterSignup(
  db: Pick<SupabaseClient, "rpc">,
  ipHash: string,
  now: Date,
  env: DeployEnv = deployEnv(),
): Promise<boolean> {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await db.rpc("bump_counter", {
      p_key: newsletterRateKey(ipHash, env),
      p_window_start: israelDayWindow(now).start.toISOString(),
    });
  } catch (err) {
    result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
  if (result.error || typeof result.data !== "number") {
    throw new GuardUnavailableError(
      `bump_counter failed: ${result.error?.message ?? "no count returned"}`,
    );
  }
  return result.data <= NEWSLETTER_SIGNUPS_PER_DAY;
}
