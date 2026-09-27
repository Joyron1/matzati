// Server-only reads for the recent-searches page (/searches) and the home strip, and the admin
// hide/restore writes. Everything goes through the service role: search_log is not public, and
// the SQL functions plus the checks in lib/recent/db.ts decide what may be shown. Public reads are
// cached for a minute (tag RECENT_TAG); /admin/searches reads fresh and calls updateTag after a
// change. The query builders live in lib/recent/db.ts and are tested with a fake client.
import "server-only";
import { unstable_cache } from "next/cache";
import { serviceClient } from "@/lib/supabase/server";
import {
  ADMIN_LIMIT,
  deleteHiddenSearch,
  HIDDEN_LIMIT,
  insertHiddenSearch,
  RecentSearchesError,
  selectCategoryCounts,
  selectHiddenSearches,
  selectLatestRecentSearches,
  selectRecentSearchList,
  toRecentQuery,
  type CategoryCounts,
  type HiddenSearch,
} from "./db";
import {
  RECENT_PAGE_SIZE,
  RECENT_TAG,
  type RecentSearch,
  type RecentSearchFilter,
  type RecentSearchList,
} from "./types";

export { RecentSearchesError, queryNormSchema, type HiddenSearch } from "./db";

const REVALIDATE_SECONDS = 60;

function logError(where: string, err: unknown) {
  // Name and message only: never the filter text or any row.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[recent] ${where}: ${text.slice(0, 200)}`);
}

// The category options ignore the filter, so they are cached once for every listing: a new text
// filter (free text, a new cache key per spelling) then costs one card read, not two.
const cachedCounts = unstable_cache(
  async (): Promise<CategoryCounts> => selectCategoryCounts(serviceClient()),
  ["recent-searches-categories"],
  { revalidate: REVALIDATE_SECONDS, tags: [RECENT_TAG] },
);

// Errors are thrown inside, so a failure is never cached. The arguments are the cache key, so
// they come from toRecentQuery(): a small, normalized key space.
const cachedList = unstable_cache(
  async (category: string | null, text: string | null, page: number): Promise<RecentSearchList> =>
    selectRecentSearchList(serviceClient(), { category, text, page }, cachedCounts()),
  ["recent-searches-list"],
  { revalidate: REVALIDATE_SECONDS, tags: [RECENT_TAG] },
);

const cachedLatest = unstable_cache(
  async (limit: number): Promise<RecentSearch[]> =>
    selectLatestRecentSearches(serviceClient(), limit),
  ["recent-searches-latest"],
  { revalidate: REVALIDATE_SECONDS, tags: [RECENT_TAG] },
);

/** One page of /searches for a filter. Cached briefly (tag RECENT_TAG). Throws RecentSearchesError. */
export async function listRecentSearches(filter: RecentSearchFilter): Promise<RecentSearchList> {
  const { category, text, page } = toRecentQuery(filter);
  try {
    return await cachedList(category, text, page);
  } catch (err) {
    logError("list", err);
    throw err instanceof RecentSearchesError
      ? err
      : new RecentSearchesError("recent searches could not be read");
  }
}

/** The newest listed searches for the home page strip; [] on any failure (logged). */
export async function latestRecentSearches(limit: number): Promise<RecentSearch[]> {
  const n = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), RECENT_PAGE_SIZE) : 1;
  try {
    return await cachedLatest(n);
  } catch (err) {
    logError("latest", err);
    return [];
  }
}

// Admin (callers must have passed requireAdmin()). Not cached: the admin sees each change at once.

/**
 * The newest listed searches, as the public page shows them: as many as its last page reaches,
 * or, with `text`, those the public text filter finds for it. Throws RecentSearchesError.
 */
export async function listAdminRecentSearches(text?: string): Promise<RecentSearch[]> {
  const query = toRecentQuery({ text, page: 1 });
  return selectLatestRecentSearches(serviceClient(), ADMIN_LIMIT, query.text);
}

/** Hidden searches, most recently hidden first. Throws RecentSearchesError. */
export async function listHiddenSearches(): Promise<HiddenSearch[]> {
  return selectHiddenSearches(serviceClient(), HIDDEN_LIMIT);
}

/** `queryNorm` must already be validated (queryNormSchema). Throws RecentSearchesError. */
export async function hideRecentSearch(queryNorm: string): Promise<void> {
  return insertHiddenSearch(serviceClient(), queryNorm);
}

/** `queryNorm` must already be validated (queryNormSchema). Throws RecentSearchesError. */
export async function restoreRecentSearch(queryNorm: string): Promise<void> {
  return deleteHiddenSearch(serviceClient(), queryNorm);
}
