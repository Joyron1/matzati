// The weekly category poll in the channel (owner request 2026-10-25): "which category would you
// like to see products from this week", so the owner knows what to post. Sunday at 12:00 Israel
// time, from the agents' cron (every 15 minutes) when the admin switched it on. Anonymous (a
// channel allows nothing else) and multiple-choice; 9 of the catalog's categories (alternating
// halves week by week, so all are asked about) and "משהו אחר". Pure parts tested.
import { CATALOG } from "@/lib/catalog/categories";
import { israelParts } from "@/lib/agents/schedule";
import { fromIsraelLocal, toIsraelLocal } from "@/lib/meta/reels-time";

export const POLL_QUESTION = "מאיזו קטגוריה הייתם רוצים לראות מוצרים השבוע? 🛍️";
export const POLL_OTHER = "משהו אחר (כתבו בקבוצת החיפושים)";
/** Telegram's limit is 10 options: 9 categories and "other". */
const PER_POLL = 9;

/** The week's options: one half of the catalog in even weeks, the other in odd ones. */
export function pollOptions(now: Date): string[] {
  const names = CATALOG.map((c) => c.nameHe);
  const week = Math.floor(now.getTime() / (7 * 24 * 60 * 60_000));
  const half = week % 2 === 0 ? names.slice(0, PER_POLL) : names.slice(PER_POLL, PER_POLL * 2);
  const options = half.length >= 2 ? half : names.slice(0, PER_POLL);
  return [...options, POLL_OTHER];
}

/** This week's poll time: the last Sunday 12:00 Israel time at or before `now`. */
export function weeklySlot(now: Date): Date {
  const day = israelParts(now).weekday; // 0 = Sunday
  const sunday = new Date(now.getTime() - day * 24 * 60 * 60_000);
  const at = fromIsraelLocal(`${toIsraelLocal(sunday).slice(0, 10)}T12:00`)!;
  return at.getTime() <= now.getTime()
    ? at
    : fromIsraelLocal(
        `${toIsraelLocal(new Date(sunday.getTime() - 7 * 24 * 60 * 60_000)).slice(0, 10)}T12:00`,
      )!;
}

/** A poll is due once this week's slot has passed and none was sent since. */
export function pollDue(now: Date, lastSent: Date | null): boolean {
  const slot = weeklySlot(now);
  return !lastSent || lastSent.getTime() < slot.getTime();
}
