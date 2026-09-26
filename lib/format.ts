const ilsFormat = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const countFormat = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });

/** "≈₪78" for converted prices, "₪78" for prices AliExpress returned in ILS. */
export function formatIls(value: number, approx: boolean): string {
  return `${approx ? "≈" : ""}₪${ilsFormat.format(Math.round(value))}`;
}

/** 3412 → "3,412" */
export function formatCount(n: number): string {
  return countFormat.format(Math.round(n));
}

/** 96.8 → "96.8%", 97 → "97%" */
export function formatPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
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

/** "2026-11-11T00:00:00+02:00" → "11.11" (Israel time). */
export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(iso));
}

/** Shares our own page URL, never the raw affiliate link. */
export function whatsappShareUrl(text: string, pageUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${pageUrl}`)}`;
}
