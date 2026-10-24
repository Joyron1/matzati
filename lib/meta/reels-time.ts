// Times of the Reels panel (owner request 2026-10-24): the owner picks an Israel wall-clock time
// ("2026-10-26T20:00" from <input type="datetime-local">), stored as an instant.
import { israelParts, israelTime } from "@/lib/agents/schedule";

/** A Reel needs this long before its time: the cron prepares it up to an hour ahead. */
export const REEL_MIN_LEAD_MS = 20 * 60_000;
/** The furthest a Reel may be scheduled. */
export const REEL_MAX_DAYS_AHEAD = 60;

/** "YYYY-MM-DDTHH:mm" in Israel time → the instant, or null when it is not a real time. */
export function fromIsraelLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const at = israelTime(y, mo, d, h, mi);
  const p = israelParts(at);
  // A day that does not exist (31.11) or an hour skipped by the clock change comes out different.
  return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi
    ? at
    : null;
}

/** The instant as "YYYY-MM-DDTHH:mm" Israel time (the input's value). */
export function toIsraelLocal(date: Date): string {
  const p = israelParts(date);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** "יום ראשון 26.10 בשעה 20:00" (Israel time). */
export function reelTimeLabel(date: Date): string {
  const p = israelParts(date);
  const two = (n: number) => String(n).padStart(2, "0");
  return `יום ${DAYS[p.weekday]} ${p.day}.${p.month} בשעה ${two(p.hour)}:${two(p.minute)}`;
}
