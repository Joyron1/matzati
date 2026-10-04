// Which big sale the top bar shows (components/sale-bar.tsx, owner request 2026-10-04) and its
// countdown. Pure: the bar runs it in the browser every second, the server once per render.
import type { Deal } from "@/lib/types";

/** A sale shows in the bar from this many days before it starts, and while it runs. */
export const SALE_BAR_WINDOW_DAYS = 45;

/** What the bar needs of a published 'holiday' deal (dates are ISO strings). */
export type BarSale = Pick<Deal, "id" | "title" | "ends_at"> & { starts_at: string };

export interface BarPick {
  sale: BarSale;
  /** Started and not ended: the bar counts down to the end instead of the start. */
  running: boolean;
}

/**
 * The sale to show at `now` (ms): a running one first, else the soonest that starts within
 * SALE_BAR_WINDOW_DAYS; null when none. Ended sales never show.
 */
export function pickBarSale(sales: readonly BarSale[], now: number): BarPick | null {
  const open = sales.filter((s) => s.ends_at === null || Date.parse(s.ends_at) > now);
  const running = open.find((s) => Date.parse(s.starts_at) <= now);
  if (running) return { sale: running, running: true };
  const horizon = now + SALE_BAR_WINDOW_DAYS * 86_400_000;
  const next = open
    .filter((s) => Date.parse(s.starts_at) <= horizon)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  return next ? { sale: next, running: false } : null;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Whole days, hours, minutes and seconds from `now` to `target` (ms); zeros once it passed. */
export function countdown(target: number, now: number): Countdown {
  const total = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** The countdown in words, for screen readers: "11 ימים, 4 שעות ו־20 דקות". Seconds left out. */
export function countdownText({ days, hours, minutes }: Countdown): string {
  const parts = [
    days > 0 ? (days === 1 ? "יום אחד" : `${days} ימים`) : null,
    hours > 0 ? (hours === 1 ? "שעה אחת" : `${hours} שעות`) : null,
    minutes === 1 ? "דקה אחת" : `${minutes} דקות`,
  ].filter((p): p is string => p !== null);
  if (parts.length === 1) return parts[0];
  const last = parts.at(-1) as string;
  // "ו־20 דקות" before a number, "ודקה אחת" before a word.
  return `${parts.slice(0, -1).join(", ")} ${/^\d/.test(last) ? "ו־" : "ו"}${last}`;
}
