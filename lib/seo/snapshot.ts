// The stored results of an SEO landing page (seo_pages.results and results_at, migration
// 20260929010000_seo_snapshots.sql): the SearchResponse the page shows, kept until a refresh
// replaces it with a run that is at least as good, and never deleted. Pure: the schema that reads
// the stored jsonb back (never trusted blindly), the replace rule, which pages the daily cron
// refreshes, and the admin's Hebrew status lines.
import { z } from "zod";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { isAllowedImage } from "@/lib/images";
import type { SearchResponse } from "@/lib/types";

/** A snapshot this old is refreshed by the daily cron, so every page is refreshed about weekly. */
export const SNAPSHOT_MAX_AGE_DAYS = 7;
/**
 * The daily cron starts at about the same time every night, so a page refreshed by one run is due
 * again on the 7th night, not the 8th: a snapshot counts as stale this much before it is 7 days old.
 */
export const CRON_SLACK_HOURS = 3;
/** The cron tries a page at most once in this window (a failed page again the next night). */
export const CRON_ATTEMPT_WINDOW_HOURS = 20;

const HOUR_MS = 3_600_000;
export const STALE_AFTER_MS = SNAPSHOT_MAX_AGE_DAYS * 24 * HOUR_MS - CRON_SLACK_HOURS * HOUR_MS;
export const CRON_ATTEMPT_WINDOW_MS = CRON_ATTEMPT_WINDOW_HOURS * HOUR_MS;

/**
 * Why the last refresh left the snapshot as it was, or a note on the one it stored
 * (seo_pages.refresh_error): a search failure code (SearchFailure in lib/search/server.ts), or
 * one of these.
 */
export const REFRESH_NOTES = {
  /** The run found no product that passes every filter. */
  empty: "empty",
  /** The run found fewer products than the snapshot shows. */
  smaller: "smaller",
  /**
   * The explain call failed: AliExpress's titles and lines built from the data. Stored only while
   * the page has no snapshot at all (better than no results), and retried the next night.
   */
  degraded: "degraded",
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

export interface SeoSnapshot {
  response: SearchResponse;
  /** When its products were fetched from AliExpress (ISO): the page's "נבדקו ב־" date. */
  resultsAt: string;
}

const count = z.number().int().nonnegative();

const chipSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["keywords", "must_have", "min_price", "max_price", "category"]),
  label_he: z.string().min(1),
  removable: z.boolean(),
});

const resultSchema = z.object({
  product_id: z.string().regex(/^\d{1,20}$/),
  title_he: z.string().min(1),
  title_en: z.string(),
  why_he: z.string(),
  price_ils: z.number().nonnegative(),
  original_price_ils: z.number().nonnegative().nullable(),
  price_is_approx: z.boolean(),
  discount_pct: z.number().nullable(),
  positive_feedback_pct: z.number().nullable(),
  units_sold: z.number().nonnegative().nullable(),
  passed_tier: z.enum(["standard", "fill"]).nullable(),
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

/** A stored snapshot: a SearchResponse with at least one result. Unknown keys are dropped. */
export const snapshotResponseSchema = z.object({
  query: z.string().min(1),
  chips: z.array(chipSchema),
  sort: z.enum(["best_value", "cheapest", "most_popular"]),
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

/**
 * The snapshot a page may show: stored results (seo_pages.results) that read back as a response
 * with results, a results_at, and made for the page's query (a snapshot of the query before an
 * edit is never shown; the edit also clears results_at). Null otherwise.
 */
export function readSnapshot(
  stored: { results: unknown; resultsAt: unknown },
  query: string,
): SeoSnapshot | null {
  const resultsAt = isoOf(stored.resultsAt);
  if (!resultsAt) return null;
  const parsed = snapshotResponseSchema.safeParse(stored.results);
  if (!parsed.success || !sameQuery(parsed.data.query, query)) return null;
  const response: SearchResponse = {
    ...parsed.data,
    results: parsed.data.results.slice(0, RESULTS_PER_PAGE),
  };
  return { response, resultsAt };
}

/**
 * When a run's products were fetched from AliExpress: its fetched_at (older than the run when it
 * came from the results cache), or `now` when that is missing or in the future.
 */
export function resultsAtOf(response: SearchResponse, now: Date): string {
  const fetched = isoOf(response.fetched_at);
  return fetched && Date.parse(fetched) <= now.getTime() + 60_000 ? fetched : now.toISOString();
}

/** One search for a page: its response and whether its explain call failed, or its failure code. */
export type SnapshotRun =
  { ok: true; response: SearchResponse; degraded: boolean } | { ok: false; error: string };

export type SnapshotDecision =
  { store: true; note: typeof REFRESH_NOTES.degraded | null } | { store: false; note: string };

/**
 * Whether a run replaces the page's snapshot (owner decision 2026-09-29): never with a failed or
 * empty run; over an existing snapshot only when it is not degraded and has at least as many
 * results, or at least a full page. A page without a snapshot takes any run with results, a
 * degraded one too (noted, so the cron tries again the next night).
 */
export function decideSnapshot(current: SeoSnapshot | null, run: SnapshotRun): SnapshotDecision {
  if (!run.ok) return { store: false, note: run.error };
  const found = run.response.results.length;
  if (found === 0) return { store: false, note: REFRESH_NOTES.empty };
  if (!current) return { store: true, note: run.degraded ? REFRESH_NOTES.degraded : null };
  if (run.degraded) return { store: false, note: REFRESH_NOTES.degraded };
  const shown = current.response.results.length;
  return found >= shown || found >= RESULTS_PER_PAGE
    ? { store: true, note: null }
    : { store: false, note: REFRESH_NOTES.smaller };
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
 * The published pages the daily cron should refresh, stalest first: no snapshot, a snapshot about
 * a week old (STALE_AFTER_MS), or one stored from a degraded run. A page tried in the last
 * CRON_ATTEMPT_WINDOW_HOURS waits (so a second call the same night does nothing), and one whose
 * last run ended with a lasting note (no products, fewer products, a query we cannot parse) waits
 * as long as a fresh snapshot would.
 */
export function pickStalePages(rows: readonly RefreshRow[], now: Date): string[] {
  const t = now.getTime();
  const time = (iso: string | null) => (iso === null ? Number.NEGATIVE_INFINITY : Date.parse(iso));
  return rows
    .filter((r) => r.published)
    .filter(
      (r) =>
        r.resultsAt === null ||
        time(r.resultsAt) <= t - STALE_AFTER_MS ||
        r.error === REFRESH_NOTES.degraded,
    )
    .filter((r) => {
      const wait = r.error && LASTING_NOTES.has(r.error) ? STALE_AFTER_MS : CRON_ATTEMPT_WINDOW_MS;
      return r.attemptedAt === null || time(r.attemptedAt) <= t - wait;
    })
    .sort(
      (a, b) =>
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
      return "ההסברים שלנו לא נכתבו בזמן. הרענון הלילי ינסה שוב.";
    default:
      return "תקלה זמנית אצלנו.";
  }
}
