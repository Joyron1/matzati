// The Meta panel's month calendar (owner request 2026-10-27): months and days in Israel time, as
// "YYYY-MM" and "YYYY-MM-DD" keys. Pure.
import { israelParts, israelTime } from "@/lib/agents/schedule";

export interface YearMonth {
  year: number;
  month: number;
}

export const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

/** Sunday first, as an Israeli calendar. */
export const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const WEEKDAYS_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const two = (n: number) => String(n).padStart(2, "0");

export const monthKey = (m: YearMonth) => `${m.year}-${two(m.month)}`;

/** The Israel month of an instant. */
export function monthOf(date: Date): YearMonth {
  const p = israelParts(date);
  return { year: p.year, month: p.month };
}

/** The Israel day of an instant, "YYYY-MM-DD". */
export function dayKeyOf(date: Date): string {
  const p = israelParts(date);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** "2026-10" → the month, or null. */
export function parseMonth(value: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? { year, month } : null;
}

const daysIn = (m: YearMonth) => new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();

/** "2026-10-29" → itself when it is a real day, else null. */
export function parseDay(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const month = parseMonth(`${m[1]}-${m[2]}`);
  const day = Number(m[3]);
  return month && day >= 1 && day <= daysIn(month) ? value : null;
}

export function shiftMonth(m: YearMonth, delta: number): YearMonth {
  const index = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The weekday (0 Sunday) of a day of the month. */
export function weekdayOf(m: YearMonth, day: number): number {
  return israelParts(israelTime(m.year, m.month, day, 12, 0)).weekday;
}

/** The month's grid, Sunday first: whole weeks, null before the 1st and after the last day. */
export function monthCells(m: YearMonth): (string | null)[] {
  const lead = weekdayOf(m, 1);
  const days = daysIn(m);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${monthKey(m)}-${two(d)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** "יום רביעי 29.10" for a day key. */
export function dayLabel(key: string): string {
  const [y, mo, d] = key.split("-").map(Number);
  return `יום ${WEEKDAYS[weekdayOf({ year: y, month: mo }, d)]} ${d}.${mo}`;
}
