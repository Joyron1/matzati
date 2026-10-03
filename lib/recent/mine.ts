// "החיפושים שלי" (owner request 2026-10-03): the visitor's own last searches, kept in this browser
// only (localStorage MY_SEARCHES_KEY), never sent to the server and never logged. Written when a
// results page for a query opens (/search?q=, however the visitor got there), read by the chips
// on the home page and /searches (components/my-searches.tsx). Necessary storage like the theme
// (STORAGE_INVENTORY in lib/consent/categories.ts): it remembers the visitor's own use of the
// site, no third party reads it, and the visitor removes one or all of it with a click.
//
// Client-reachable: no zod (lib/consent has the same rule), the stored JSON is checked by hand.
// Every storage access is wrapped: private modes and blocked site data throw, and the feature then
// simply shows nothing.

/** The localStorage key. */
export const MY_SEARCHES_KEY = "matzati_my_searches";
/** At most this many searches are kept, newest first. */
export const MY_SEARCHES_MAX = 12;
/** A longer query is cut (the search itself takes 200 characters, MAX_QUERY_LENGTH). */
const MAX_QUERY_CHARS = 200;
/** Window event the store fires after a change, so every list on the page updates. */
export const MY_SEARCHES_EVENT = "matzati:my-searches";

export interface MySearch {
  /** The query as the visitor searched it (trimmed, inner whitespace collapsed). */
  q: string;
  /** When it was last searched, ms since the epoch. */
  at: number;
}

const NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

/** The same query typed with trivial differences (case, spacing, niqqud, quotes) is one entry. */
export function mySearchKey(q: string): string {
  return q
    .normalize("NFKC")
    .replace(NIQQUD, "")
    .toLowerCase()
    .replace(/["'״׳“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

/** The stored list, read defensively: anything malformed is dropped, never thrown. */
export function parseMySearches(raw: string | null): MySearch[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const valid: MySearch[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const { q, at } = item as { q?: unknown; at?: unknown };
    if (typeof q !== "string" || typeof at !== "number" || !Number.isFinite(at)) continue;
    const clean = cleanQuery(q);
    if (mySearchKey(clean)) valid.push({ q: clean, at });
  }
  // Newest first, then one entry per query: the newest.
  const seen = new Set<string>();
  return valid
    .sort((a, b) => b.at - a.at)
    .filter((s) => {
      const key = mySearchKey(s.q);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MY_SEARCHES_MAX);
}

/** The list with `q` first (its older entry removed), at most MY_SEARCHES_MAX. */
export function addMySearch(list: readonly MySearch[], q: string, at: number): MySearch[] {
  const clean = cleanQuery(q);
  const key = mySearchKey(clean);
  if (!key) return [...list];
  const rest = list.filter((s) => mySearchKey(s.q) !== key);
  return [{ q: clean, at }, ...rest].slice(0, MY_SEARCHES_MAX);
}

/** The list without `q` (compared as mySearchKey). */
export function removeMySearch(list: readonly MySearch[], q: string): MySearch[] {
  const key = mySearchKey(q);
  return list.filter((s) => mySearchKey(s.q) !== key);
}

// --- Browser storage -----------------------------------------------------------------------------

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked site data
  }
}

/** The stored list; [] when storage is unavailable or holds something else. */
export function readMySearches(store: Storage | null = storage()): MySearch[] {
  if (!store) return [];
  try {
    return parseMySearches(store.getItem(MY_SEARCHES_KEY));
  } catch {
    return [];
  }
}

function write(list: readonly MySearch[], store: Storage | null): void {
  if (!store) return;
  try {
    if (list.length) store.setItem(MY_SEARCHES_KEY, JSON.stringify(list));
    else store.removeItem(MY_SEARCHES_KEY);
  } catch {
    // Full or blocked storage: the feature just remembers less.
  }
  try {
    window.dispatchEvent(new Event(MY_SEARCHES_EVENT));
  } catch {
    // Outside a browser (tests with a fake store).
  }
}

/** Remembers that the visitor searched `q` now. */
export function rememberMySearch(q: string, store: Storage | null = storage()): void {
  write(addMySearch(readMySearches(store), q, Date.now()), store);
}

/** Forgets one search. */
export function forgetMySearch(q: string, store: Storage | null = storage()): void {
  write(removeMySearch(readMySearches(store), q), store);
}

/** Forgets every search. */
export function clearMySearches(store: Storage | null = storage()): void {
  write([], store);
}
