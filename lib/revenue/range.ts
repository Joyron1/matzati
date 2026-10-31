// The date range of the admin's revenue page (owner request 2026-10-29): Israel calendar days,
// "from" and "to" both included, read from the address (?from=2026-10-01&to=2026-10-29). Pure.
import { isoToIsraelLocal, israelLocalToIso } from "@/lib/deals/time";

/** Days shown when the address names no range: the last 30, today included. */
export const DEFAULT_RANGE_DAYS = 30;
/**
 * The longest range: order.list is read a month at a time (doc 1913), 4 calls a window at least,
 * and an order unsettled 180 days after payment turns Invalid anyway.
 */
export const MAX_RANGE_DAYS = 90;
/** One order.list window, in days. */
export const WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface RevenueRange {
  /** "YYYY-MM-DD", Israel dates, both included. */
  from: string;
  to: string;
}

const toMs = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A day plus `n` days (negative for earlier). */
export const addDays = (day: string, n: number) => fromMs(toMs(day) + n * DAY_MS);

/** The number of days from `from` to `to`, both included. */
export const rangeDays = (r: RevenueRange) => Math.round((toMs(r.to) - toMs(r.from)) / DAY_MS) + 1;

/** A real "YYYY-MM-DD" date, else null (2026-02-30 is not one). */
function validDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = DATE.exec(value.trim());
  if (!m) return null;
  const day = m[0];
  return fromMs(toMs(day)) === day ? day : null;
}

/** Today's Israel date. */
export const israelToday = (now: Date) => isoToIsraelLocal(now.toISOString()).slice(0, 10);

/**
 * The range the address asks for. A missing or broken date falls back to the default range's
 * end; a day after today is today; reversed ends are swapped; a range over MAX_RANGE_DAYS keeps
 * its end and starts MAX_RANGE_DAYS - 1 days earlier.
 */
export function parseRange(
  params: { from?: string | string[]; to?: string | string[] },
  now: Date,
): RevenueRange {
  const today = israelToday(now);
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const clamp = (day: string) => (day > today ? today : day);
  let to = clamp(validDay(first(params.to)) ?? today);
  let from = clamp(validDay(first(params.from)) ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1)));
  if (from > to) [from, to] = [to, from];
  if (rangeDays({ from, to }) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to };
}

/** The instants the range covers: Israel midnight of `from` to Israel midnight after `to`, or now. */
export function rangeInstants(range: RevenueRange, now: Date): { start: Date; end: Date } {
  const start = new Date(israelLocalToIso(`${range.from}T00:00`) ?? `${range.from}T00:00:00Z`);
  const next = addDays(range.to, 1);
  const end = new Date(israelLocalToIso(`${next}T00:00`) ?? `${next}T00:00:00Z`);
  return { start, end: end > now ? now : end };
}

/** The range cut into order.list windows of at most WINDOW_DAYS, earliest first. */
export function orderWindows(start: Date, end: Date): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += WINDOW_DAYS * DAY_MS) {
    out.push({
      start: new Date(t),
      end: new Date(Math.min(t + WINDOW_DAYS * DAY_MS, end.getTime())),
    });
  }
  return out;
}

export interface RangePreset {
  label: string;
  range: RevenueRange;
}

/** The quick ranges above the date fields. */
export function rangePresets(now: Date): RangePreset[] {
  const today = israelToday(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { label: "היום", range: { from: today, to: today } },
    { label: "7 ימים", range: { from: addDays(today, -6), to: today } },
    { label: "30 יום", range: { from: addDays(today, -29), to: today } },
    { label: "90 יום", range: { from: addDays(today, -89), to: today } },
    { label: "החודש", range: { from: monthStart, to: today } },
    { label: "החודש הקודם", range: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd } },
  ];
}

/** /admin/revenue for a range. */
export const rangeHref = (r: RevenueRange) =>
  `/admin/revenue?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
