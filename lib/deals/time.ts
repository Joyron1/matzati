// Deal date rules, plus wall-clock conversions for the admin form's datetime-local inputs (Israel
// time, or Pacific time as AliExpress announces its sales) and the countdown text on /sales.
// Pure: safe for server code, client components and tests.
import type { TimeLeft } from "@/lib/format";
import type { Deal } from "@/lib/types";

export const ISRAEL_TIME_ZONE = "Asia/Jerusalem";
/** AliExpress announces sale and coupon times in US Pacific time. */
export const PACIFIC_TIME_ZONE = "America/Los_Angeles";

type Window = Pick<Deal, "starts_at" | "ends_at">;

/** Ended once ends_at is reached. No ends_at means it never ends on its own. */
export function hasEnded(deal: Window, now: Date): boolean {
  return deal.ends_at !== null && Date.parse(deal.ends_at) <= now.getTime();
}

/** Started once starts_at is reached. No starts_at means it runs from the moment it is published. */
export function hasStarted(deal: Window, now: Date): boolean {
  return deal.starts_at === null || Date.parse(deal.starts_at) <= now.getTime();
}

/** Running right now: started and not ended. */
export function isCurrent(deal: Window, now: Date): boolean {
  return hasStarted(deal, now) && !hasEnded(deal, now);
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** A wall-clock formatter for an IANA zone; null when the zone is unknown. */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(timeZone)) {
    let format: Intl.DateTimeFormat | null;
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      format = null; // RangeError: not a time zone this runtime knows
    }
    formatters.set(timeZone, format);
  }
  return formatters.get(timeZone) ?? null;
}

interface WallClock {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

function wallClock(ms: number, format: Intl.DateTimeFormat): WallClock {
  const p = Object.fromEntries(
    format.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]),
  );
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** The zone's UTC offset in ms at instant `ms`. */
function offsetAt(ms: number, format: Intl.DateTimeFormat): number {
  const w = wallClock(ms, format);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000;
}

// "2026-11-11T00:00" (datetime-local), "2026-11-11T00:00:05", "2026-12-31 23:59:59".
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

const DAY_MS = 86_400_000;

/**
 * A local wall-clock value ("2026-12-31T23:59", "2026-12-31T23:59:59" or "2026-12-31 23:59:59")
 * in an IANA time zone ("America/Los_Angeles" for AliExpress times, "Asia/Jerusalem" for the
 * admin form) as an ISO instant. Null when it is not a real date and time, or the zone is unknown.
 *
 * Clock changes follow the usual "compatible" rule: a wall time the spring-forward gap skips lands
 * as far after the gap as it was into it (02:30 → 03:30), which is what the admin meant; a wall
 * time the fall-back hour repeats means its first occurrence.
 */
export function zonedLocalToIso(value: string, timeZone: string): string | null {
  const format = zoneFormatter(timeZone);
  const m = LOCAL_INPUT.exec(value.trim());
  if (!format || !m) return null;
  const [y, mo, d, h, min, s] = m.slice(1).map((v) => Number(v ?? 0));
  const naive = Date.UTC(y, mo - 1, d, h, min, s);
  const check = new Date(naive);
  // Rejects 2026-02-30, 25:00 and the like, which Date.UTC would silently roll over.
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== min ||
    check.getUTCSeconds() !== s
  ) {
    return null;
  }
  // Clock changes are months apart, so the offsets a day before and a day after are the only two
  // this wall time can have.
  const before = naive - offsetAt(naive - DAY_MS, format);
  const after = naive - offsetAt(naive + DAY_MS, format);
  const shows = (t: number) => t + offsetAt(t, format) === naive;
  // `before` is the earlier instant in a repeated hour and the shifted one in a gap.
  const instant = shows(before) || !shows(after) ? before : after;
  return new Date(instant).toISOString();
}

/**
 * A datetime-local value ("2026-11-11T00:00") read as Israel wall-clock time, as an ISO instant.
 * Null when the value is not a real date and time. In the spring-forward gap (a wall time that
 * does not exist in Israel) the result lands an hour later, which is what the admin meant.
 */
export function israelLocalToIso(value: string): string | null {
  return zonedLocalToIso(value, ISRAEL_TIME_ZONE);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO instant as a datetime-local value in `timeZone` ("2026-11-11T00:00"); "" for none. */
export function isoToZonedLocal(iso: string | null | undefined, timeZone: string): string {
  const format = zoneFormatter(timeZone);
  if (!iso || !format) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const w = wallClock(ms, format);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.min)}`;
}

/** An ISO instant as a datetime-local value in Israel time ("2026-11-11T00:00"); "" for none. */
export function isoToIsraelLocal(iso: string | null | undefined): string {
  return isoToZonedLocal(iso, ISRAEL_TIME_ZONE);
}

/**
 * A datetime-local value in one zone as the same instant in another ("" when it is not a real
 * date and time). The admin form shows the moment an admin typed in the other zone.
 */
export function convertLocal(value: string, fromZone: string, toZone: string): string {
  return isoToZonedLocal(zonedLocalToIso(value, fromZone), toZone);
}

/**
 * The instant to print when an end time is shown as a date alone. An end at Israel midnight
 * (12.11 00:00) covers the day before, so it is printed as that day ("עד 11.11"), the way the
 * /sales calendar marks it (saleSpan); any other end is its own day. Returned unchanged when it is
 * not a valid instant.
 */
export function lastCoveredInstant(endIso: string): string {
  const format = zoneFormatter(ISRAEL_TIME_ZONE);
  const ms = Date.parse(endIso);
  if (!format || !Number.isFinite(ms)) return endIso;
  const w = wallClock(ms, format);
  if (w.h !== 0 || w.min !== 0 || w.s !== 0) return endIso;
  return new Date(Math.floor(ms / 1000) * 1000 - 1).toISOString();
}

const unit = (n: number, one: string, two: string, many: string) =>
  n === 1 ? one : n === 2 ? two : `${n} ${many}`;
const days = (n: number) => unit(n, "יום", "יומיים", "ימים");
const hours = (n: number) => unit(n, "שעה", "שעתיים", "שעות");
const minutes = (n: number) => unit(n, "דקה", "שתי דקות", "דקות");
// "ו" is written straight onto a word and with a maqaf before a number: "ושעה", "ו־4 שעות".
const and = (text: string) => (/^\d/.test(text) ? `ו־${text}` : `ו${text}`);

/**
 * Time left as the two largest units, for the small countdowns on /sales: "12 ימים ו־4 שעות",
 * "יומיים", "שעה ו־20 דקות", "5 דקות", "פחות מדקה".
 */
export function formatTimeLeft(left: TimeLeft): string {
  if (left.days > 0) {
    return left.hours > 0 ? `${days(left.days)} ${and(hours(left.hours))}` : days(left.days);
  }
  if (left.hours > 0) {
    return left.minutes > 0
      ? `${hours(left.hours)} ${and(minutes(left.minutes))}`
      : hours(left.hours);
  }
  return left.minutes > 0 ? minutes(left.minutes) : "פחות מדקה";
}
