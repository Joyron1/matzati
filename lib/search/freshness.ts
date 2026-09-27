// Results can come from the 14-day search cache (CLAUDE.md §6.2), so once they are older than
// STALE_RESULTS_HOURS the results page says when their prices were checked. Pure: the server
// render decides it once, with its own clock.
import { STALE_RESULTS_HOURS } from "@/lib/config/site";

/**
 * `fetchedAt` (ISO) when results fetched then are older than STALE_RESULTS_HOURS at `now`; null
 * when they are newer, or when the time is missing or invalid (nothing true to show).
 */
export function staleFetchedAt(fetchedAt: string | undefined, now: Date): string | null {
  if (!fetchedAt) return null;
  const at = Date.parse(fetchedAt);
  if (Number.isNaN(at)) return null;
  return now.getTime() - at > STALE_RESULTS_HOURS * 3_600_000 ? fetchedAt : null;
}
