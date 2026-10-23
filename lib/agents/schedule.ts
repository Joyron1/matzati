// When the agents' approved posts go out (owner decisions 2026-10-23), pure: Israel time, fixed
// slots, never from Friday 17:00 to Saturday 19:30 (Shabbat and its eve, with margin).

export const ISRAEL_TZ = "Asia/Jerusalem";

/** Telegram's daily slots (Israel time); at most one post per slot. */
export const TELEGRAM_SLOTS = ["10:00", "15:00", "20:00"] as const;

/** A slot sooner than this after the approval is skipped (time to look at the post again). */
export const MIN_LEAD_MS = 10 * 60_000;

/** How far ahead a slot is looked for. */
export const MAX_DAYS_AHEAD = 60;

interface IsraelParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The Israel calendar date and clock time of `date`. */
export function israelParts(date: Date): IsraelParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** The instant of an Israel wall-clock time (daylight saving included). */
export function israelTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // The offset at the guess, then once more at the corrected instant (the day DST changes).
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const p = israelParts(new Date(instant));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    instant += guess - shown;
  }
  return new Date(instant);
}

/** Friday 17:00 to Saturday 19:30, Israel time: nothing is posted. */
export function isQuietTime(date: Date): boolean {
  const p = israelParts(date);
  const minutes = p.hour * 60 + p.minute;
  if (p.weekday === 5) return minutes >= 17 * 60;
  if (p.weekday === 6) return minutes < 19 * 60 + 30;
  return false;
}

/**
 * The next free slot after `now` (+ MIN_LEAD_MS): one of `slots` on any day, not in quiet time,
 * not one of `taken` (instants already given to other posts). Null when none within
 * MAX_DAYS_AHEAD.
 */
export function nextSlot(
  now: Date,
  taken: readonly Date[],
  slots: readonly string[] = TELEGRAM_SLOTS,
): Date | null {
  const takenSet = new Set(taken.map((d) => d.getTime()));
  const today = israelParts(now);
  for (let d = 0; d <= MAX_DAYS_AHEAD; d++) {
    // Noon of the day d days on: safe from DST edges when stepping days.
    const noon = israelTime(today.year, today.month, today.day, 12, 0);
    const day = israelParts(new Date(noon.getTime() + d * 86_400_000));
    for (const slot of slots) {
      const [h, m] = slot.split(":").map(Number);
      const at = israelTime(day.year, day.month, day.day, h, m);
      if (at.getTime() < now.getTime() + MIN_LEAD_MS) continue;
      if (isQuietTime(at) || takenSet.has(at.getTime())) continue;
      return at;
    }
  }
  return null;
}

/** "יום ג׳ 20:00, 27.10" for the admin. */
export function slotLabel(date: Date): string {
  const p = israelParts(date);
  const days = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `יום ${days[p.weekday]} ${hh}:${mm}, ${p.day}.${p.month}`;
}
