// Reads for the public recent-searches page (/searches) and hide/restore for /admin/searches,
// taking the Supabase client as a parameter so tests can pass a fake. lib/recent/queries.ts binds
// them to the service role (search_log is not public) and caches the public reads.
// The SQL functions (supabase/migrations/20260927210000_recent_searches.sql) already keep only
// listable, not hidden rows, and only production ones (search_log.env, recent_search_cards in
// 20260928140000_search_telemetry.sql: dev and preview searches share the database but are never
// listed); every row is checked again here, and a row that fails a check (an unexpected parse
// shape, a query isListableQuery rejects) is skipped, never shown half-built.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isAllowedImage } from "@/lib/images";
import { normalizeQuery } from "@/lib/search/cache-key";
import { buildChips } from "@/lib/search/chips";
import type { ParsedQuery } from "@/lib/search/filters";
import { categoryLabelHe } from "@/lib/tips/category";
import { cleanRecentText } from "./params";
import { isListableQuery } from "./privacy";
import {
  OTHER_CATEGORY,
  RECENT_MAX_PAGES,
  RECENT_PAGE_SIZE,
  type RecentCategory,
  type RecentSearch,
  type RecentSearchFilter,
  type RecentSearchImage,
  type RecentSearchList,
} from "./types";

export type RecentClient = Pick<SupabaseClient, "rpc" | "from">;

export const HIDDEN_TABLE = "hidden_searches";
/** Label of the OTHER_CATEGORY bucket: categories without a Hebrew name, and unknown ones. */
export const OTHER_LABEL_HE = "אחר";
/**
 * How many listed searches /admin/searches shows: every card the unfiltered public page can reach
 * (its last page). Older ones are found with the admin text filter, like the public one.
 */
export const ADMIN_LIMIT = RECENT_PAGE_SIZE * RECENT_MAX_PAGES;
/** How many hidden searches /admin/searches shows (recent_searches_hidden clamps to 500). */
export const HIDDEN_LIMIT = 500;
/** A search shows 3 results, so a card has at most 3 photos. */
const RESULTS_SHOWN = 3;

// AliExpress category ids are numeric (same rule as the ?cat= parameter in ./params.ts).
const CATEGORY_ID = /^\d{1,12}$/;

/** The database failed; the page shows an error card. The message comes from PostgREST. */
export class RecentSearchesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecentSearchesError";
  }
}

/** search_log.query_norm as the admin hides it: normalized text, never padded. */
export const queryNormSchema = z
  .string()
  .min(1)
  .max(400)
  .refine((s) => s.trim() === s);

const timestamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

const HOUR_MS = 3_600_000;

/** Rounded down to the hour (Israel is a whole number of hours from UTC). */
function floorToHour(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(ms - (ms % HOUR_MS)).toISOString();
}

// A price bound is absent from the stored JSON when the search had none; null is read the same.
const price = z
  .number()
  .positive()
  .nullish()
  .transform((n) => n ?? undefined);

// search_log.parsed: the ParsedQuery the search ran with (lib/search/filters.ts, after
// normalizeParsed). Its labels become the card's chips, so an unexpected shape skips the card.
const parsedSchema = z.object({
  keywords_en: z.string(),
  product_terms: z.array(z.string()),
  product_he: z.string().trim().min(1),
  requirements: z.array(
    z.object({ en: z.string().min(1), alt: z.array(z.string()), he: z.string().trim().min(1) }),
  ),
  min_price_ils: price,
  max_price_ils: price,
  sort_preference: z.enum(["best_value", "cheapest", "most_popular"]),
  category_hint: z.string().nullish(),
});

/** The stored parse as a ParsedQuery, or null when it does not have the expected shape. */
export function toParsedQuery(value: unknown): ParsedQuery | null {
  const parsed = parsedSchema.safeParse(value);
  if (!parsed.success) return null;
  const { min_price_ils, max_price_ils, category_hint, ...rest } = parsed.data;
  return {
    ...rest,
    ...(min_price_ils !== undefined ? { min_price_ils } : {}),
    ...(max_price_ils !== undefined ? { max_price_ils } : {}),
    ...(category_hint ? { category_hint } : {}),
  };
}

const imageSchema = z.object({ src: z.string(), alt: z.string().nullable() });

/** Up to 3 photos we can render, in result order, one per URL. A missing alt reads the label. */
function toImages(value: unknown, fallbackAlt: string): RecentSearchImage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const images: RecentSearchImage[] = [];
  for (const item of value) {
    const image = imageSchema.safeParse(item);
    if (!image.success || !isAllowedImage(image.data.src) || seen.has(image.data.src)) continue;
    seen.add(image.data.src);
    images.push({ src: image.data.src, alt: image.data.alt?.trim() || fallbackAlt });
  }
  return images.slice(0, RESULTS_SHOWN);
}

const cardRowSchema = z.object({
  query_norm: z.string().min(1),
  query: z.string(),
  parsed: z.unknown(),
  category_id: z.string().nullable(),
  // PostgREST sends integers as JSON numbers, but a string is accepted too.
  results_count: z.coerce.number().int(),
  searched_at: timestamp,
  images: z.unknown(),
});

/** A recent_searches row as a card, or null when any check fails (skipped, not a crash). */
export function toRecentSearch(row: unknown): RecentSearch | null {
  const parsedRow = cardRowSchema.safeParse(row);
  if (!parsedRow.success) return null;
  const r = parsedRow.data;
  // Checked again at read time: a row listed under older rules is not shown once they tighten.
  if (r.results_count < 1 || !isListableQuery(r.query)) return null;
  const parsed = toParsedQuery(r.parsed);
  if (!parsed) return null;
  const categoryId =
    r.category_id !== null && CATEGORY_ID.test(r.category_id) ? r.category_id : null;
  return {
    queryNorm: r.query_norm,
    query: r.query.trim(),
    chips: buildChips(parsed),
    categoryId,
    categoryHe: categoryId === null ? null : categoryLabelHe(categoryId),
    images: toImages(r.images, parsed.product_he),
    resultsCount: Math.min(r.results_count, RESULTS_SHOWN),
    // Never the exact time: on a quiet site it could tie the query to whoever searched then.
    searchedAt: floorToHour(r.searched_at),
  };
}

/** Cards in row order; one per normalized query even if the database sent two. */
export function toRecentSearches(rows: unknown[]): RecentSearch[] {
  const seen = new Set<string>();
  const cards: RecentSearch[] = [];
  for (const row of rows) {
    const card = toRecentSearch(row);
    if (!card || seen.has(card.queryNorm)) continue;
    seen.add(card.queryNorm);
    cards.push(card);
  }
  return cards;
}

const categoryRowSchema = z.object({
  category_id: z.string().nullable(),
  cards: z.coerce.number().int().nonnegative(),
});

export interface CategoryCounts {
  /** Named categories plus one OTHER_CATEGORY bucket, most cards first. */
  categories: RecentCategory[];
  /** Listed category ids without a Hebrew name: with unknown ones, they make up OTHER_CATEGORY. */
  otherIds: string[];
}

/**
 * recent_search_categories rows as filter options: every category with a Hebrew name
 * (categoryLabelHe) on its own, the rest (no name, unknown or malformed id) as one "אחר" bucket.
 * Most cards first; on a tie "אחר" goes last and names go in Hebrew order.
 */
export function toCategoryCounts(rows: unknown[]): CategoryCounts {
  const named: RecentCategory[] = [];
  const otherIds: string[] = [];
  let other = 0;
  for (const row of rows) {
    const parsed = categoryRowSchema.safeParse(row);
    if (!parsed.success || parsed.data.cards === 0) continue;
    const { category_id: id, cards } = parsed.data;
    const labelHe = id !== null && CATEGORY_ID.test(id) ? categoryLabelHe(id) : null;
    if (id !== null && labelHe !== null) {
      named.push({ id, labelHe, count: cards });
      continue;
    }
    other += cards;
    if (id !== null) otherIds.push(id);
  }
  named.sort((a, b) => b.count - a.count || a.labelHe.localeCompare(b.labelHe, "he"));
  const categories = [...named];
  if (other > 0) {
    // Last among equal counts: after every named category with at least as many cards.
    const at = categories.findIndex((c) => c.count < other);
    categories.splice(at === -1 ? categories.length : at, 0, {
      id: OTHER_CATEGORY,
      labelHe: OTHER_LABEL_HE,
      count: other,
    });
  }
  return { categories, otherIds };
}

/** The filter as the database reads it; also the cache key of a listing (lib/recent/queries.ts). */
export interface RecentQuery {
  /** A category id with a Hebrew name, OTHER_CATEGORY, or null for every category. */
  category: string | null;
  /** normalizeQuery(text), or null for no text filter. */
  text: string | null;
  /** 1..RECENT_MAX_PAGES. */
  page: number;
}

/**
 * Normalizes a filter so equivalent filters share one cache entry: an id without a Hebrew name
 * is part of "אחר" (the page has no option for it), text is compared as normalizeQuery does,
 * and the page is a whole number in 1..RECENT_MAX_PAGES.
 */
export function toRecentQuery(filter: RecentSearchFilter): RecentQuery {
  const { category: c } = filter;
  const category =
    c === OTHER_CATEGORY
      ? OTHER_CATEGORY
      : c !== undefined && CATEGORY_ID.test(c)
        ? categoryLabelHe(c) === null
          ? OTHER_CATEGORY
          : c
        : null;
  const cleaned = filter.text === undefined ? undefined : cleanRecentText(filter.text);
  const text = cleaned === undefined ? "" : normalizeQuery(cleaned);
  const page = Number.isInteger(filter.page)
    ? Math.min(Math.max(filter.page, 1), RECENT_MAX_PAGES)
    : 1;
  return { category, text: text || null, page };
}

type DbResult = { data: unknown; error: { message: string } | null };

async function run(query: PromiseLike<DbResult>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw new RecentSearchesError(error.message);
  return data;
}

/** Rows of a set-returning function: an array, or an error for anything else. */
async function rows(query: PromiseLike<DbResult>): Promise<unknown[]> {
  const data = (await run(query)) ?? [];
  if (!Array.isArray(data)) throw new RecentSearchesError("unexpected response shape");
  return data;
}

interface CardArgs {
  limit: number;
  /** Only these category ids (plus unknown ones when includeUnknown); null = every category. */
  categoryIds: string[] | null;
  includeUnknown: boolean;
  /** normalizeQuery(text), or null. */
  text: string | null;
}

function selectCardRows(db: RecentClient, args: CardArgs): Promise<unknown[]> {
  return rows(
    db.rpc("recent_searches", {
      p_limit: args.limit,
      p_category_ids: args.categoryIds,
      p_include_unknown: args.includeUnknown,
      p_text: args.text,
    }),
  );
}

export async function selectCategoryCounts(db: RecentClient): Promise<CategoryCounts> {
  return toCategoryCounts(await rows(db.rpc("recent_search_categories")));
}

/**
 * One page of /searches: the first page * RECENT_PAGE_SIZE cards for the filter, whether more
 * exist (never past RECENT_MAX_PAGES, which the page cannot link to) and the category options,
 * which ignore the filter. `counts` defaults to a fresh read; lib/recent/queries.ts passes its
 * cached one, so a new filter costs one card read only. Throws RecentSearchesError.
 */
export async function selectRecentSearchList(
  db: RecentClient,
  query: RecentQuery,
  counts: Promise<CategoryCounts> = selectCategoryCounts(db),
): Promise<RecentSearchList> {
  const shown = query.page * RECENT_PAGE_SIZE;
  // One more than shown, to learn whether there are more.
  const base = { limit: shown + 1, text: query.text };
  // "אחר" needs the unnamed ids first; any other filter reads both at once.
  const cards =
    query.category === OTHER_CATEGORY
      ? counts.then(({ otherIds }) =>
          selectCardRows(db, { ...base, categoryIds: otherIds, includeUnknown: true }),
        )
      : selectCardRows(db, {
          ...base,
          categoryIds: query.category === null ? null : [query.category],
          includeUnknown: false,
        });
  const [{ categories }, found] = await Promise.all([counts, cards]);
  return {
    items: toRecentSearches(found.slice(0, shown)),
    hasMore: query.page < RECENT_MAX_PAGES && found.length > shown,
    categories,
  };
}

/**
 * The newest listed searches (home strip, admin list), in every category; with `text`
 * (normalizeQuery form, see RecentQuery) only those it matches. Throws RecentSearchesError.
 */
export async function selectLatestRecentSearches(
  db: RecentClient,
  limit: number,
  text: string | null = null,
): Promise<RecentSearch[]> {
  const found = await selectCardRows(db, {
    limit,
    categoryIds: null,
    includeUnknown: false,
    text,
  });
  return toRecentSearches(found);
}

// Admin (service role; callers have passed requireAdmin()).

export interface HiddenSearch {
  queryNorm: string;
  /** ISO time it was hidden. */
  hiddenAt: string;
  /** Its latest spelling as typed, or null when no listable search has that text any more. */
  query: string | null;
}

const hiddenRowSchema = z.object({
  query_norm: z.string().min(1),
  hidden_at: timestamp,
  query: z.string().nullable(),
});

/** Hidden searches, most recently hidden first. Rows with an unexpected shape are skipped. */
export async function selectHiddenSearches(
  db: RecentClient,
  limit: number = HIDDEN_LIMIT,
): Promise<HiddenSearch[]> {
  const found = await rows(db.rpc("recent_searches_hidden", { p_limit: limit }));
  return found.flatMap((row) => {
    const parsed = hiddenRowSchema.safeParse(row);
    if (!parsed.success) return [];
    const { query_norm, hidden_at, query } = parsed.data;
    return [{ queryNorm: query_norm, hiddenAt: hidden_at, query }];
  });
}

/** Takes every search with this normalized text off the page. Hiding it twice is not an error. */
export async function insertHiddenSearch(db: RecentClient, queryNorm: string): Promise<void> {
  if (!queryNormSchema.safeParse(queryNorm).success) return;
  await run(
    db
      .from(HIDDEN_TABLE)
      .upsert({ query_norm: queryNorm }, { onConflict: "query_norm", ignoreDuplicates: true }),
  );
}

/** Lists it again (if it still passes the checks). Restoring one that is not hidden is fine. */
export async function deleteHiddenSearch(db: RecentClient, queryNorm: string): Promise<void> {
  if (!queryNormSchema.safeParse(queryNorm).success) return;
  await run(db.from(HIDDEN_TABLE).delete().eq("query_norm", queryNorm));
}
