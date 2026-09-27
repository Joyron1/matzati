const wholeFormat = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const agorotFormat = new Intl.NumberFormat("he-IL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Exact ILS prices (as AliExpress returned them) keep their agorot: "₪13.37", "₪13".
 * Prices we converted from USD are rounded and marked: "≈₪78".
 */
export function formatIls(value: number, approx: boolean): string {
  if (approx) return `≈₪${wholeFormat.format(Math.round(value))}`;
  const agorot = Math.round(value * 100);
  const text =
    agorot % 100 === 0 ? wholeFormat.format(agorot / 100) : agorotFormat.format(agorot / 100);
  return `₪${text}`;
}

/** 3412 → "3,412" */
export function formatCount(n: number): string {
  return wholeFormat.format(Math.round(n));
}

/** 96.8 → "96.8%", 97 → "97%" */
export function formatPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/** Wait time for "נסו שוב בעוד ...": "דקה", "12 דקות", "שעה", "שעתיים", "5 שעות". */
export function formatWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes === 1) return "דקה";
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.ceil(minutes / 60);
  if (hours === 1) return "שעה";
  if (hours === 2) return "שעתיים";
  return `${hours} שעות`;
}

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
}

/** Whole days/hours/minutes from `now` until `target`, or null once it has passed. */
export function timeUntil(target: Date, now: Date): TimeLeft | null {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}

const shortDate = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "numeric",
  timeZone: "Asia/Jerusalem",
});

const shortTime = new Intl.DateTimeFormat("he-IL", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Jerusalem",
});

/** "2026-11-11T00:00:00+02:00" → "11.11" (Israel time). */
export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(iso));
}

/** "2026-09-27T11:05:00Z" → "27.9 בשעה 14:05" (Israel time). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${shortDate.format(date)} בשעה ${shortTime.format(date)}`;
}

/** Shares our own page URL, never the raw affiliate link. */
export function whatsappShareUrl(text: string, pageUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${pageUrl}`)}`;
}
