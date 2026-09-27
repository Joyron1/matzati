// The /sales calendar: which Israel calendar days each sale covers, a 12-month grid of weeks and
// an agenda grouped by month. Pure (the page passes the time of the visit), so it is unit-tested.
import type { Deal } from "@/lib/types";
import { ISRAEL_TIME_ZONE } from "./time";

/** "2026-11-11" */
export type DayKey = string;

// en-CA formats as YYYY-MM-DD.
const israelDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ISRAEL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const monthLabelFormat = new Intl.DateTimeFormat("he-IL", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_MS = 86_400_000;

/** The calendar day in Israel of an instant: "2026-11-11". */
export function israelDay(instant: Date | string): DayKey {
  return israelDayFormat.format(typeof instant === "string" ? new Date(instant) : instant);
}

const dayNumber = (key: DayKey) => Date.parse(`${key}T00:00:00Z`) / DAY_MS;
const dayKey = (n: number): DayKey => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** "2026-11-11" → "11.11", the short date the site uses everywhere. */
export function shortDay(key: DayKey): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d}.${m}`;
}

export interface SaleSpan {
  id: string;
  title: string;
  /** First and last Israel day of the sale; the same day when it has no end. */
  startDay: DayKey;
  endDay: DayKey;
}

/**
 * The Israel days a sale covers: from the day it starts to the day of its last minute (a sale
 * ending at midnight does not cover the next day). Without ends_at only the start day is marked:
 * we do not guess how long a sale runs. Null without starts_at.
 */
export function saleSpan(
  sale: Pick<Deal, "id" | "title" | "starts_at" | "ends_at">,
): SaleSpan | null {
  if (!sale.starts_at) return null;
  const start = Date.parse(sale.starts_at);
  if (!Number.isFinite(start)) return null;
  const startDay = israelDay(new Date(start));
  const end = sale.ends_at ? Date.parse(sale.ends_at) : NaN;
  const lastDay = Number.isFinite(end) && end > start ? israelDay(new Date(end - 1)) : startDay;
  return { id: sale.id, title: sale.title, startDay, endDay: lastDay };
}

/** "11.11", or "11.11 עד 13.11" for a sale of several days. */
export function spanLabel(span: Pick<SaleSpan, "startDay" | "endDay">): string {
  return span.startDay === span.endDay
    ? shortDay(span.startDay)
    : `${shortDay(span.startDay)} עד ${shortDay(span.endDay)}`;
}

export interface CalendarDay {
  key: DayKey;
  /** Day of the month. */
  day: number;
  isToday: boolean;
  isPast: boolean;
  /** Sales running on this day, in the order they were given. */
  sales: Pick<SaleSpan, "id" | "title">[];
}

export interface CalendarMonth {
  /** "2026-11" */
  key: string;
  /** "נובמבר 2026" */
  label: string;
  /** Sunday-first weeks; null pads the days before the 1st and after the last day. */
  weeks: (CalendarDay | null)[][];
  /** Sales that touch this month, in the order they were given. */
  sales: SaleSpan[];
}

/**
 * `count` months starting with the current Israel month, each as Sunday-first weeks with the
 * sale days and today marked. `sales` should come earliest first (salesCalendar does that).
 */
export function buildSalesCalendar(
  sales: Pick<Deal, "id" | "title" | "starts_at" | "ends_at">[],
  now: Date,
  count = 12,
): CalendarMonth[] {
  const spans = sales.map(saleSpan).filter((s): s is SaleSpan => s !== null);
  const today = dayNumber(israelDay(now));
  const [year, month] = israelDay(now).split("-").map(Number);

  return Array.from({ length: count }, (_, i) => {
    const first = new Date(Date.UTC(year, month - 1 + i, 1));
    const y = first.getUTCFullYear();
    const m = first.getUTCMonth() + 1;
    const firstDay = first.getTime() / DAY_MS;
    const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lastDay = firstDay + length - 1;

    const touching = spans.filter(
      (s) => dayNumber(s.startDay) <= lastDay && dayNumber(s.endDay) >= firstDay,
    );
    const cells: (CalendarDay | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
    for (let n = firstDay; n <= lastDay; n++) {
      cells.push({
        key: dayKey(n),
        day: n - firstDay + 1,
        isToday: n === today,
        isPast: n < today,
        sales: touching
          .filter((s) => dayNumber(s.startDay) <= n && dayNumber(s.endDay) >= n)
          .map(({ id, title }) => ({ id, title })),
      });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

    return {
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: monthLabelFormat.format(first),
      weeks,
      sales: touching,
    };
  });
}
