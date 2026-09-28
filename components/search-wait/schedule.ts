// Timing of the search waiting screen (components/search-view.tsx shows it until a search's results
// are complete). The page knows two real moments of a search (lib/search/pipeline.ts stages): the
// query is understood (its chips), and the products are ranked (their lines are then written).
// Every step is marked done only by one of them: understanding by the chips, scanning, filtering
// and ranking by the ranked products. Between them, a schedule from the moment the query was
// understood makes scanning, then filtering, the current step (AliExpress answers in about 1-3 s
// a call, and the fetch filters every page it gets); a step the schedule moved past is shown as
// past, never as done. Ranking is never claimed by the schedule (it takes no time and ends the
// fetch), and "כותבים לכם למה בחרנו" is current only once the products are ranked and their lines
// are really being written. The progress bar eases toward PROGRESS_CAP without reaching it, and
// each real moment raises it to a floor.

export type WaitStepId = "read" | "scan" | "filter" | "rank" | "write";

export interface WaitStep {
  id: WaitStepId;
  /** The step in the list, plural and true for every search. */
  label: string;
  /** One more sentence for the current step, under the list. */
  detail: string;
}

export const WAIT_STEPS: readonly WaitStep[] = [
  {
    id: "read",
    label: "מבינים מה אתם מחפשים",
    detail: "מזהים את המוצר, את התקציב ואת מה שחשוב לכם.",
  },
  {
    id: "scan",
    label: "סורקים עשרות מוצרים באלי אקספרס",
    // product.query sorted by LAST_VOLUME_DESC (lib/search/pipeline.ts).
    detail: "מבקשים מאלי אקספרס את המוצרים הנמכרים ביותר שמתאימים לחיפוש.",
  },
  {
    id: "filter",
    label: "מסננים לפי משוב חיובי ומכירות",
    detail: "בודקים משוב חיובי, מכירות ב־30 הימים האחרונים והתאמה למה שביקשתם.",
  },
  {
    id: "rank",
    label: "מדרגים את המוצרים שעברו",
    // byRank in lib/ranking/rank.ts; commission only breaks exact ties.
    detail: "לפי משוב, מכירות, מחיר והתאמה לחיפוש.",
  },
  {
    id: "write",
    label: "כותבים לכם למה בחרנו",
    // The explain call (lib/llm/explain.ts) writes from the product's displayed data only.
    detail: "לכל מוצר שנציג משפט קצר על הסיבה שבחרנו בו, רק מהנתונים שלו.",
  },
];

export const READ_STEP = 0;
export const SCAN_STEP = 1;
export const FILTER_STEP = 2;
export const RANK_STEP = 3;
export const WRITE_STEP = 4;
export const LAST_STEP = WAIT_STEPS.length - 1;

/**
 * The delay of the wait's entrance (`.enter` in search-wait.module.css, 0.18s): a search whose
 * results come sooner (a cached one) never shows the wait.
 */
export const WAIT_ENTER_DELAY_MS = 180;

/**
 * After the query is understood, when filtering becomes the current step: the first AliExpress
 * page usually arrives within 1-3 s, and every page is filtered as it comes.
 */
export const FILTER_AFTER_MS = 3_000;

/** What the page knows of the search so far (the stages lib/search/pipeline.ts streams). */
export interface WaitSignals {
  /** When the query was understood, in ms from the start of the wait; null while it is not. */
  understoodAtMs: number | null;
  /** The products are ranked (so fetched, filtered and ranked). */
  ranked: boolean;
  /** Ranked, and their lines are being written. */
  writing: boolean;
}

export const NO_SIGNALS: WaitSignals = { understoodAtMs: null, ranked: false, writing: false };

/** "done" only for what a real moment proved; "past" for a step the schedule moved past. */
export type StepState = "done" | "past" | "current" | "upcoming";

/** Steps known to be done: none, understanding, or everything before writing. */
export function doneSteps(s: WaitSignals): number {
  if (s.ranked) return WRITE_STEP;
  return s.understoodAtMs !== null ? SCAN_STEP : 0;
}

/**
 * The current step, or -1 for none: ranked products whose lines were all known already (the page
 * shows at once). Writing only once the page knows the lines are being written.
 */
export function currentStep(elapsedMs: number, s: WaitSignals): number {
  if (s.ranked) return s.writing ? WRITE_STEP : -1;
  if (s.understoodAtMs === null) return READ_STEP;
  return elapsedMs - s.understoodAtMs >= FILTER_AFTER_MS ? FILTER_STEP : SCAN_STEP;
}

/** Every step's state at `elapsedMs` into the wait. */
export function stepStates(elapsedMs: number, s: WaitSignals): StepState[] {
  const done = doneSteps(s);
  const current = currentStep(elapsedMs, s);
  return WAIT_STEPS.map((_, i) =>
    i < done ? "done" : i === current ? "current" : i < current ? "past" : "upcoming",
  );
}

/** The bar eases toward this share and never gets there on its own. */
export const PROGRESS_CAP = 0.9;
/** Time constant of the ease: about 55% at 7 s and 75% at 11 s, a typical fresh search. */
const PROGRESS_TAU_MS = 6_000;

/** Share of the progress bar filled by time alone after `elapsedMs`: always below PROGRESS_CAP. */
export function progressAt(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return PROGRESS_CAP * (1 - Math.exp(-elapsedMs / PROGRESS_TAU_MS));
}

/**
 * The bar is one CSS animation from 0 to PROGRESS_CAP (no re-render per frame): this curve over
 * PROGRESS_EASE_MS follows progressAt to within half a percent.
 */
export const PROGRESS_EASE = [0.155, 0.9, 0.325, 1] as const;
export const PROGRESS_EASE_MS = 36_000;

/** The least the bar shows once a real moment happened: it never waits for the clock. */
export function progressFloor(s: WaitSignals): number {
  if (s.ranked) return 0.8;
  return s.understoodAtMs !== null ? 0.2 : 0;
}

/** The bar under reduced motion: one fixed width per step reached, PROGRESS_CAP at the last. */
export function stepProgress(step: number): number {
  const clamped = Math.min(Math.max(Math.trunc(step), 0), LAST_STEP);
  return (PROGRESS_CAP * (clamped + 1)) / WAIT_STEPS.length;
}

export type Reassurance = "none" | "slow" | "slower";

/**
 * The results of a fresh search usually show within 5-12 s; after 12 s the screen says why it
 * takes long, and later that it is still on it.
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
 * The next moment after `elapsedMs` at which the schedule changes something on screen (filtering
 * becomes current, a reassurance shows), or null when nothing more changes on its own. The screen
 * re-renders only then and at the real moments.
 */
export function nextMarkMs(elapsedMs: number, s: WaitSignals): number | null {
  const marks = [SLOW_AFTER_MS, SLOWER_AFTER_MS];
  if (s.understoodAtMs !== null && !s.ranked) marks.push(s.understoodAtMs + FILTER_AFTER_MS);
  const later = marks.filter((t) => t > elapsedMs);
  return later.length ? Math.min(...later) : null;
}

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
