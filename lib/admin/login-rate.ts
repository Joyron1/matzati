// Rate limit for admin sign-in attempts (a password try or a magic-link request): 10 per hour per
// salted IP hash, counted atomically by public.bump_counter under the key "al:<hash>" (same table
// and hour window as the search limits). 10, not the 5 of the link-only days, so a couple of typos
// and a link still fit; still far too few to guess a 12-character password.
import type { SupabaseClient } from "@supabase/supabase-js";
import { GuardUnavailableError, hourWindow } from "@/lib/guard/rate-limit";

export const ADMIN_LOGINS_PER_HOUR = 10;

export const adminLoginKey = (ipHash: string) => `al:${ipHash}`;

/**
 * Counts one sign-in attempt for this IP hash in the current UTC hour and returns whether it is
 * still within the limit. Throws GuardUnavailableError when the database fails (callers refuse).
 */
export async function allowAdminLogin(
  db: SupabaseClient,
  ipHash: string,
  now: Date,
): Promise<boolean> {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await db.rpc("bump_counter", {
      p_key: adminLoginKey(ipHash),
      p_window_start: hourWindow(now).start.toISOString(),
    });
  } catch (err) {
    result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
  if (result.error || typeof result.data !== "number") {
    throw new GuardUnavailableError(
      `bump_counter failed: ${result.error?.message ?? "no count returned"}`,
    );
  }
  return result.data <= ADMIN_LOGINS_PER_HOUR;
}
