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

const dateWithYear = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: "Asia/Jerusalem",
});

// "2026-09-27": the calendar day in Israel, comparable across dates.
const israelDay = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Jerusalem",
});

function israelDayNumber(date: Date): number {
  return Date.parse(`${israelDay.format(date)}T00:00:00Z`) / 86_400_000;
}

/**
 * How long ago `iso` was, for recent-search cards: "עכשיו", "לפני 5 דקות", "לפני שעה",
 * "לפני 3 שעות", "אתמול", "לפני 4 ימים", then the date ("20.9", with the year when it is not
 * this year). Days count calendar days in Israel time.
 */
export function formatTimeAgo(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "עכשיו"; // also a time slightly ahead of our clock
  if (minutes < 60) return minutes === 1 ? "לפני דקה" : `לפני ${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    if (hours === 1) return "לפני שעה";
    if (hours === 2) return "לפני שעתיים";
    return `לפני ${hours} שעות`;
  }
  const days = israelDayNumber(now) - israelDayNumber(date);
  if (days <= 1) return "אתמול";
  if (days === 2) return "לפני יומיים";
  if (days < 7) return `לפני ${days} ימים`;
  const sameYear = israelDay.format(date).slice(0, 4) === israelDay.format(now).slice(0, 4);
  return (sameYear ? shortDate : dateWithYear).format(date);
}

/**
 * formatTimeAgo for a time rounded down to the hour (recent-search cards): under an hour it says
 * "בשעה האחרונה", since minutes counted from the rounded time would be wrong.
 */
export function formatHourAgo(iso: string, now: Date): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return now.getTime() - at < 3_600_000 ? "בשעה האחרונה" : formatTimeAgo(iso, now);
}

/**
 * Display text only, never a query or a URL: keeps a price in one piece when Hebrew text wraps, so
 * "עד 100 ש״ח" and "בין 50 ל־150 ש״ח" never leave a number or ש״ח alone on a line. A no-break
 * space glues the number to ש״ח and to עד/בין; a word joiner stops a break after the maqaf.
 */
export function keepPricesTogether(text: string): string {
  return text
    .replace(/(\d) (?=ש״ח)/g, "$1 ")
    .replace(/(^|\s)(עד|בין) (?=\d)/g, "$1$2 ")
    .replace(/־(?=\d)/g, "־⁠");
}

/** Shares our own page URL, never the raw affiliate link. */
export function whatsappShareUrl(text: string, pageUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${pageUrl}`)}`;
}
