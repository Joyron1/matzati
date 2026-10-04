// The stored results of an SEO landing page (seo_pages.results and results_at, migration
// 20260929010000_seo_snapshots.sql): up to SEO_MAX_PRODUCTS products in groups of five
// (./results.ts), kept until a refresh replaces them with a run that is at least as good, and
// never deleted. Pure: the schema that reads the stored jsonb back (never trusted blindly), the
// replace rule, which pages the cron refreshes or continues, and the admin's Hebrew status lines.
import { z } from "zod";
import { RESULTS_PER_PAGE, SEO_MAX_PRODUCTS } from "@/lib/config/site";
import { isAllowedImage } from "@/lib/images";
import type { SearchResponse } from "@/lib/types";
import {
  canContinue,
  fromSearchResponse,
  SEO_RESULTS_VERSION,
  shownCount,
  withDataLead,
  type SeoResults,
} from "./results";

/** A snapshot this old is refreshed by the daily cron, so every page is refreshed about weekly. */
export const SNAPSHOT_MAX_AGE_DAYS = 7;
/**
 * The daily cron starts at about the same time every night, so a page refreshed by one run is due
 * again on the 7th night, not the 8th: a snapshot counts as stale this much before it is 7 days old.
 */
export const CRON_SLACK_HOURS = 3;
/** The cron tries a page at most once in this window (a failed page again the next night). */
export const CRON_ATTEMPT_WINDOW_HOURS = 20;
/**
 * A page whose lines are still being written (a run that ran out of time, a failed explain call)
 * is continued by the next cron run after this long (the cron runs about hourly at night), or at
 * once from the admin list.
 */
export const CONTINUE_AFTER_MINUTES = 30;
/** A run stored beside the shown results (`next`) that is older than this is fetched again. */
export const NEXT_MAX_AGE_HOURS = 48;

const HOUR_MS = 3_600_000;
export const STALE_AFTER_MS = SNAPSHOT_MAX_AGE_DAYS * 24 * HOUR_MS - CRON_SLACK_HOURS * HOUR_MS;
export const CRON_ATTEMPT_WINDOW_MS = CRON_ATTEMPT_WINDOW_HOURS * HOUR_MS;
export const CONTINUE_AFTER_MS = CONTINUE_AFTER_MINUTES * 60_000;
export const NEXT_MAX_AGE_MS = NEXT_MAX_AGE_HOURS * HOUR_MS;

/**
 * Why the last refresh left the snapshot as it was, or a note on the one it stored
 * (seo_pages.refresh_error): a search failure code (SearchFailure in lib/search/server.ts), or
 * one of these.
 */
export const REFRESH_NOTES = {
  /** The run found no product that passes every filter. */
  empty: "empty",
  /** The run found fewer products than the snapshot has. */
  smaller: "smaller",
  /**
   * The first group shows lines built from the data and AliExpress's titles: stored only while
   * the page had nothing else to show, and explained again soon.
   */
  degraded: "degraded",
  /** Some groups still wait for their lines (or a newer run waits beside the shown one). */
  incomplete: "incomplete",
  /** Stored by the page's first render (one page of a visitor's search): the cron collects all. */
  firstRun: "first_run",
  /** The run had no time left for its first AliExpress call. */
  time: "time",
} as const;

/**
 * Notes that another run soon would not change: the cron waits a week before trying such a page
 * again, instead of paying for a search every night.
 */
const LASTING_NOTES: ReadonlySet<string> = new Set([
  REFRESH_NOTES.empty,
  REFRESH_NOTES.smaller,
  "parse_failed",
  "invalid_query",
]);

/** Notes of a page whose lines a run can finish without fetching (or should soon). */
const CONTINUE_NOTES: ReadonlySet<string> = new Set([
  REFRESH_NOTES.incomplete,
  REFRESH_NOTES.degraded,
]);

export interface SeoSnapshot {
  /** The results the page shows. */
  results: SeoResults;
  /** A newer run whose lines are still being written, shown once it is at least as good. */
  next: SeoResults | null;
  /** When the shown products were fetched from AliExpress (ISO): the page's "נבדקו ב־" date. */
  resultsAt: string;
}

const count = z.number().int().nonnegative();
const sortSchema = z.enum(["best_value", "cheapest", "most_popular"]);
const productId = z.string().regex(/^\d{1,20}$/);

const chipSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["keywords", "must_have", "min_price", "max_price", "category"]),
  label_he: z.string().min(1),
  removable: z.boolean(),
});

const resultSchema = z.object({
  product_id: productId,
  title_he: z.string().min(1),
  title_en: z.string(),
  why_he: z.string(),
  price_ils: z.number().nonnegative(),
  original_price_ils: z.number().nonnegative().nullable(),
  price_is_approx: z.boolean(),
  discount_pct: z.number().nullable(),
  positive_feedback_pct: z.number().nullable(),
  units_sold: z.number().nonnegative().nullable(),
  passed_tier: z.enum(["standard", "fill", "loose"]).nullable(),
  shared_numbers: z.object({ feedback: z.boolean(), sales: z.boolean() }).optional(),
  // Only AliExpress's image CDN over https: next/image throws on any other host.
  image_urls: z.array(z.string()).transform((urls) => urls.filter(isAllowedImage)),
  category_id: z.string().nullable(),
});

const blockerSchema = z.object({
  chip_id: z.string(),
  would_pass: count,
  title_matches: count.nullable(),
  size_cap: z.literal(true).optional(),
});

/** A snapshot stored before groups (a SearchResponse with at least one result). */
export const snapshotResponseSchema = z.object({
  query: z.string().min(1),
  chips: z.array(chipSchema),
  sort: sortSchema,
  checked_count: count,
  passed_count: count,
  results: z.array(resultSchema).min(1),
  more_available: z.boolean(),
  filters_key: z.string().optional(),
  cached: z.boolean().optional(),
  fetched_at: z.string().optional(),
  blockers: z.array(blockerSchema).optional(),
  not_filtered: z.array(z.string()).optional(),
});

const contextSchema = z.object({
  product_he: z.string(),
  requirements_he: z.array(z.string()),
  min_price_ils: z.number().optional(),
  max_price_ils: z.number().optional(),
  sort_preference: sortSchema,
});

const isoString = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

/** Groups that cover the products exactly, in order, five at most each, all but the last full. */
function groupsCoverResults(r: {
  results: { product_id: string }[];
  groups: { ids: string[] }[];
}): boolean {
  const ids = r.groups.flatMap((g) => g.ids);
  const full = r.groups.slice(0, -1).every((g) => g.ids.length === RESULTS_PER_PAGE);
  return (
    full &&
    ids.length === r.results.length &&
    new Set(ids).size === ids.length &&
    ids.every((id, i) => id === r.results[i].product_id)
  );
}

/** Stored results in groups (./results.ts). Unknown keys are dropped. */
export const seoResultsSchema = z
  .object({
    v: z.literal(SEO_RESULTS_VERSION),
    query: z.string().min(1),
    chips: z.array(chipSchema),
    sort: sortSchema,
    checked_count: count,
    passed_count: count,
    not_filtered: z.array(z.string()).optional(),
    fetched_at: isoString,
    full: z.boolean(),
    context: contextSchema.nullable(),
    explain_version: z.number().int().nonnegative(),
    results: z.array(resultSchema).min(1).max(SEO_MAX_PRODUCTS),
    groups: z
      .array(
        z.object({
          ids: z.array(productId).min(1).max(RESULTS_PER_PAGE),
          state: z.enum(["model", "data", "pending"]),
        }),
      )
      .min(1),
  })
  .refine(groupsCoverResults);

function isoOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Spacing and Unicode forms aside, the query a snapshot was made for is the page's query. */
function sameQuery(a: string, b: string): boolean {
  const clean = (q: string) => q.normalize("NFKC").replace(/\s+/g, " ").trim();
  return clean(a) === clean(b);
}

/** Stored results in any shape we wrote (groups, or an older SearchResponse), or null. */
export function readResults(value: unknown): SeoResults | null {
  const grouped = seoResultsSchema.safeParse(value);
  if (grouped.success) return grouped.data;
  const older = snapshotResponseSchema.safeParse(value);
  return older.success ? fromSearchResponse(older.data as SearchResponse) : null;
}

/**
 * The snapshot a page may show: stored results that read back with at least one product, a
 * results_at, and made for the page's query (a snapshot of the query before an edit is never
 * shown; the edit also clears results_at). A `next` run that does not read back, or was made for
 * another query, is left out. Null otherwise.
 */
export function readSnapshot(
  stored: { results: unknown; resultsAt: unknown },
  query: string,
): SeoSnapshot | null {
  const resultsAt = isoOf(stored.resultsAt);
  if (!resultsAt) return null;
  const results = readResults(stored.results);
  if (!results || !sameQuery(results.query, query)) return null;
  const rawNext =
    typeof stored.results === "object" && stored.results !== null
      ? (stored.results as { next?: unknown }).next
      : undefined;
  const next = rawNext === undefined ? null : seoResultsSchema.safeParse(rawNext);
  return {
    results,
    next: next?.success && sameQuery(next.data.query, query) ? next.data : null,
    resultsAt,
  };
}

/**
 * When a run's products were fetched from AliExpress: its fetched_at (older than the run when it
 * came from the results cache), or `now` when that is missing, unreadable or in the future.
 */
export function resultsAtOf(results: Pick<SeoResults, "fetched_at">, now: Date): string {
  const fetched = isoOf(results.fetched_at);
  return fetched && Date.parse(fetched) > 0 && Date.parse(fetched) <= now.getTime() + 60_000
    ? fetched
    : now.toISOString();
}

/** One run for a page: its results, or its failure code. */
export type SnapshotRun = { ok: true; results: SeoResults } | { ok: false; error: string };

/**
 * What a stored run is noted with: its first group shows the lines from the data (degraded), some
 * groups wait for lines (incomplete), it is one page of a first render (first_run), or nothing.
 */
export function noteOf(r: SeoResults): string | null {
  if (r.groups[0]?.state === "data") return REFRESH_NOTES.degraded;
  if (canContinue(r)) return REFRESH_NOTES.incomplete;
  if (!r.full) return REFRESH_NOTES.firstRun;
  return null;
}

export type SnapshotDecision =
  /** The run becomes the page's results. */
  | { action: "replace"; results: SeoResults; note: string | null }
  /** The run is kept beside the shown results until its lines are written (`next`). */
  | { action: "next"; results: SeoResults; note: typeof REFRESH_NOTES.incomplete }
  /** Nothing changes; `note` says why. */
  | { action: "keep"; note: string };

/**
 * Whether a run replaces the page's snapshot (owner decisions 2026-09-29): never with a failed or
 * empty run, and never with a smaller one (fewer products than the snapshot has, unless a full
 * SEO_MAX_PRODUCTS). A run with at least as many products replaces it once it shows at least as
 * many as the snapshot shows; until then it waits beside it (`next`) while the next runs write
 * its lines, so the page never shows fewer products for a while. A page without a snapshot takes
 * any run with products; with no group explained yet, its first group shows the lines from the
 * data (degraded) rather than nothing.
 */
export function decideSnapshot(current: SeoSnapshot | null, run: SnapshotRun): SnapshotDecision {
  if (!run.ok) return { action: "keep", note: run.error };
  const r = run.results;
  const found = r.results.length;
  if (found === 0) return { action: "keep", note: REFRESH_NOTES.empty };
  const shownNow = current ? shownCount(current.results) : 0;
  const shown = shownCount(r);
  if (current && found < current.results.results.length && found < SEO_MAX_PRODUCTS) {
    return { action: "keep", note: REFRESH_NOTES.smaller };
  }
  if (shown === 0 && shownNow === 0) {
    const lead = withDataLead(r);
    return { action: "replace", results: lead, note: noteOf(lead) };
  }
  if (shown >= shownNow) return { action: "replace", results: r, note: noteOf(r) };
  return { action: "next", results: r, note: REFRESH_NOTES.incomplete };
}

/**
 * What a refresh of a page with this snapshot does first: write the missing lines of the run
 * waiting beside it (while it is younger than NEXT_MAX_AGE_HOURS), or of the shown results;
 * null for a new collection.
 */
export function continueTarget(
  snapshot: SeoSnapshot | null,
  now: Date,
): { results: SeoResults; which: "next" | "shown" } | null {
  if (!snapshot) return null;
  const next = snapshot.next;
  if (next && canContinue(next) && Date.parse(next.fetched_at) > now.getTime() - NEXT_MAX_AGE_MS) {
    return { results: next, which: "next" };
  }
  if (!next && canContinue(snapshot.results)) return { results: snapshot.results, which: "shown" };
  return null;
}

/** What the cron needs to know of a page (seo_pages, times as ISO or null). */
export interface RefreshRow {
  slug: string;
  published: boolean;
  resultsAt: string | null;
  attemptedAt: string | null;
  error: string | null;
}

/**
 * The published pages the cron should refresh or continue: first those whose lines are still
 * being written (incomplete, degraded; CONTINUE_AFTER_MINUTES after the last try), then those
 * without a snapshot, with a snapshot about a week old (STALE_AFTER_MS) or from a first render,
 * stalest first. A page tried in the last CRON_ATTEMPT_WINDOW_HOURS waits (so a second call the
 * same night does nothing), and one whose last run ended with a lasting note (no products, fewer
 * products, a query we cannot parse) waits as long as a fresh snapshot would.
 */
export function pickStalePages(rows: readonly RefreshRow[], now: Date): string[] {
  const t = now.getTime();
  const time = (iso: string | null) => (iso === null ? Number.NEGATIVE_INFINITY : Date.parse(iso));
  const continuing = (r: RefreshRow) => r.error !== null && CONTINUE_NOTES.has(r.error);
  return rows
    .filter((r) => r.published)
    .filter(
      (r) =>
        r.resultsAt === null ||
        time(r.resultsAt) <= t - STALE_AFTER_MS ||
        continuing(r) ||
        r.error === REFRESH_NOTES.firstRun,
    )
    .filter((r) => {
      const wait = continuing(r)
        ? CONTINUE_AFTER_MS
        : r.error && LASTING_NOTES.has(r.error)
          ? STALE_AFTER_MS
          : CRON_ATTEMPT_WINDOW_MS;
      return r.attemptedAt === null || time(r.attemptedAt) <= t - wait;
    })
    .sort(
      (a, b) =>
        Number(continuing(b)) - Number(continuing(a)) ||
        time(a.resultsAt) - time(b.resultsAt) ||
        time(a.attemptedAt) - time(b.attemptedAt) ||
        a.slug.localeCompare(b.slug),
    )
    .map((r) => r.slug);
}

/**
 * Refresh after an admin save (owner decision 2026-09-29): when the saved page is published and it
 * was not before (a new page, or a draft published now), or its query changed.
 */
export function shouldRefreshAfterSave(
  previous: { query: string; published: boolean } | null,
  saved: { query: string; published: boolean },
): boolean {
  if (!saved.published) return false;
  return previous === null || !previous.published || previous.query !== saved.query;
}

/** The admin's Hebrew line for a refresh note (seo_pages.refresh_error). */
export function refreshNoteText(note: string, hasSnapshot: boolean): string {
  switch (note) {
    case "upstream":
      return "אלי אקספרס לא ענתה בזמן (לרוב עומס רגעי).";
    case "llm":
      return "השירות שמבין את החיפוש לא ענה בזמן.";
    case "capacity":
      return "מכסת החיפושים היומית נגמרה.";
    case "parse_failed":
      return "לא הצלחנו להבין את החיפוש של הדף. כדאי לנסח אותו אחרת.";
    case "invalid_query":
      return "החיפוש של הדף ריק או ארוך מדי.";
    case REFRESH_NOTES.empty:
      return hasSnapshot
        ? "הרענון לא מצא מוצרים שעוברים את הסינון, ולכן נשארו התוצאות הקודמות."
        : "לא נמצאו מוצרים שעוברים את הסינון. כדאי לנסח את החיפוש אחרת.";
    case REFRESH_NOTES.smaller:
      return "הרענון מצא פחות מוצרים מהשמורים, ולכן נשארו התוצאות הקודמות.";
    case REFRESH_NOTES.degraded:
      return "ההסברים שלנו לקבוצה הראשונה עוד לא נכתבו. הרענון הבא ינסה שוב.";
    case REFRESH_NOTES.incomplete:
      return "חלק מההסברים עוד לא נכתבו. הרענון הבא ישלים אותם בלי לחפש מחדש.";
    case REFRESH_NOTES.firstRun:
      return "נשמר עמוד ראשון מהביקור הראשון. הרענון הלילי יאסוף את כל המוצרים.";
    case REFRESH_NOTES.time:
      return "לא נשאר זמן לחיפוש בהרצה הזו. הרענון הבא ינסה שוב.";
    default:
      return "תקלה זמנית אצלנו.";
  }
}
