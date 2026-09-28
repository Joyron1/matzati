// Timing of the search waiting screen (the Suspense fallbacks of app/search/page.tsx). The page
// streams (docs/search-quality-plan.md item 15): the chips once the query is understood, the
// products once they are ranked, their "why we picked it" lines after that, on the cards. So the
// wait covers understanding the query and finding the products, and knows one thing for real: once
// the chips show, the first step is done (UNDERSTOOD_STEPS). The other steps advance on a schedule
// that follows the typical durations of a fresh search (parse ≈1.5-3 s, AliExpress ≈2-8 s with up
// to 3 spaced calls, filtering and ranking are instant), a step the schedule moved past is shown as
// past, never as done, the last step never ends on its own, and the progress bar eases toward
// PROGRESS_CAP without reaching it. A cached search returns in well under a second, so its
// visitors barely see the first step.

export type WaitStepId = "read" | "scan" | "filter" | "rank" | "prepare";

export interface WaitStep {
  id: WaitStepId;
  /** The step in the list, plural and true for every search. */
  label: string;
  /** One more sentence for the current step, under the list. */
  detail: string;
  /** When the schedule makes this step the current one, from the start of the wait. */
  startsAtMs: number;
}

export const WAIT_STEPS: readonly WaitStep[] = [
  {
    id: "read",
    label: "מבינים מה אתם מחפשים",
    detail: "מזהים את המוצר, את התקציב ואת מה שחשוב לכם.",
    startsAtMs: 0,
  },
  {
    id: "scan",
    label: "סורקים עשרות מוצרים באלי אקספרס",
    // product.query sorted by LAST_VOLUME_DESC (lib/search/pipeline.ts).
    detail: "מבקשים מאלי אקספרס את המוצרים הנמכרים ביותר שמתאימים לחיפוש.",
    startsAtMs: 2_000,
  },
  {
    id: "filter",
    label: "מסננים לפי משוב חיובי ומכירות",
    detail: "בודקים משוב חיובי, מכירות ב־30 הימים האחרונים והתאמה למה שביקשתם.",
    startsAtMs: 5_000,
  },
  {
    id: "rank",
    label: "מדרגים את המוצרים שעברו",
    // byRank in lib/ranking/rank.ts; commission only breaks exact ties.
    detail: "לפי משוב, מכירות, מחיר והתאמה לחיפוש.",
    startsAtMs: 6_500,
  },
  {
    id: "prepare",
    label: "עוד רגע, מכינים את המוצרים לצפייה",
    detail: "המוצרים יופיעו כאן, ומיד אחריהם משפט קצר לכל אחד על הסיבה שבחרנו בו.",
    startsAtMs: 8_500,
  },
];

export const LAST_STEP = WAIT_STEPS.length - 1;

/**
 * The delay of the wait's entrance (`.enter` in search-wait.module.css, 0.18s): a wait replaced
 * sooner was never seen. A wait that was up longer has started to show, so the wait under the
 * chips that follows it goes on without an entrance of its own (app/search/page.tsx).
 */
export const WAIT_ENTER_DELAY_MS = 180;

/** Steps the page knows are done once the chips show: understanding the query. */
export const UNDERSTOOD_STEPS = 1;

/**
 * "past", not "done", for a step the schedule moved past: that says nothing about the search.
 * "done" only for a step the page knows is over (UNDERSTOOD_STEPS once the chips are shown).
 */
export type StepState = "done" | "past" | "current" | "upcoming";

/** The step the schedule shows as current. Never past the last one, which has no end. */
export function stepAt(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  let step = 0;
  for (let i = 1; i < WAIT_STEPS.length; i++) {
    if (elapsedMs >= WAIT_STEPS[i].startsAtMs) step = i;
  }
  return step;
}

/**
 * Done (the first `done` steps, known to be over), past, current or upcoming. The last step is
 * never past or done: only the real page ends the wait. The current step is never one known to be
 * done.
 */
export function stepState(index: number, current: number, done = 0): StepState {
  const known = Math.min(Math.max(Math.trunc(done), 0), LAST_STEP);
  if (index < known) return "done";
  const now = Math.min(Math.max(current, known), LAST_STEP);
  if (index < now) return "past";
  return index === now ? "current" : "upcoming";
}

/** The bar eases toward this share and never gets there on its own. */
export const PROGRESS_CAP = 0.9;
/** Time constant of the ease: about 55% at 7 s and 75% at 11 s, a typical fresh search. */
const PROGRESS_TAU_MS = 6_000;

/** Share of the progress bar filled after `elapsedMs`: 0 at the start, always below PROGRESS_CAP. */
export function progressAt(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return PROGRESS_CAP * (1 - Math.exp(-elapsedMs / PROGRESS_TAU_MS));
}

/**
 * The bar is one CSS animation from 0 to PROGRESS_CAP (no re-render per frame): this curve over
 * PROGRESS_EASE_MS follows progressAt to within half a percent. A negative delay of the wait's
 * start offset continues it from progressAt(offset).
 */
export const PROGRESS_EASE = [0.155, 0.9, 0.325, 1] as const;
export const PROGRESS_EASE_MS = 36_000;

/** The bar under reduced motion: one fixed width per step, PROGRESS_CAP at the last one. */
export function stepProgress(step: number): number {
  const clamped = Math.min(Math.max(Math.trunc(step), 0), LAST_STEP);
  return (PROGRESS_CAP * (clamped + 1)) / WAIT_STEPS.length;
}

export type Reassurance = "none" | "slow" | "slower";

/**
 * The products of a fresh search usually show within 3-8 s (their lines follow on the cards);
 * after 12 s the screen says why it takes long, and later that it is still on it.
 */
export const SLOW_AFTER_MS = 12_000;
export const SLOWER_AFTER_MS = 25_000;

export function reassuranceAt(elapsedMs: number): Reassurance {
  if (elapsedMs >= SLOWER_AFTER_MS) return "slower";
  if (elapsedMs >= SLOW_AFTER_MS) return "slow";
  return "none";
}

/** True per the 14-day search cache (CACHE_TTL_DAYS in lib/search/cache-key.ts). */
export const REASSURANCE_TEXT: Record<Exclude<Reassurance, "none">, string> = {
  slow: "חיפוש חדש לוקח כמה שניות, כי אנחנו בודקים את המוצרים עכשיו. חיפוש שכבר נעשה לאחרונה חוזר מיד.",
  slower: "הפעם זה לוקח יותר מהרגיל. אנחנו עדיין בודקים, והתוצאות יופיעו כאן.",
};

/**
 * Where the schedule starts. Removing a chip or changing the sort re-runs the search with the
 * cached parse (CLAUDE.md §6), so there is nothing to read: the wait starts at the AliExpress step.
 */
export function startOffsetMs(reusesParse: boolean): number {
  return reusesParse ? WAIT_STEPS[1].startsAtMs : 0;
}

/**
 * Where the wait shown under the chips starts (the query is understood): where the wait it replaces
 * had got to, `elapsedBefore` (null when there was none), and never before the AliExpress step.
 */
export function understoodOffsetMs(elapsedBefore: number | null): number {
  const scan = WAIT_STEPS[1].startsAtMs;
  return elapsedBefore !== null && elapsedBefore > scan ? elapsedBefore : scan;
}

/** Every moment the schedule changes something on screen: the screen re-renders only then. */
export const SCHEDULE_MARKS_MS: readonly number[] = [
  ...new Set([...WAIT_STEPS.slice(1).map((s) => s.startsAtMs), SLOW_AFTER_MS, SLOWER_AFTER_MS]),
].sort((a, b) => a - b);

/** How long a tip stays up: time to read it (about 60 ms a character), 5 to 9 seconds. */
export function tipDurationMs(text: string): number {
  return Math.min(9_000, Math.max(5_000, 2_000 + 60 * text.length));
}

export function nextTip(index: number, count: number): number {
  if (count <= 0) return 0;
  return (((Math.trunc(index) + 1) % count) + count) % count;
}

/** Same cap as MAX_QUERY_LENGTH in lib/search/pipeline.ts, a server module. */
const MAX_ECHO_LENGTH = 200;

/** The query as the page will search it: trimmed, one space between words, capped. */
export function echoQuery(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ECHO_LENGTH);
}
