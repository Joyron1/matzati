// Two-level search cache keys (owner decision 2026-09-27, CLAUDE.md §6.2):
// 1. queryKey: the same request typed with trivial differences (spacing, niqqud, quotes,
//    ש״ח / שקל / ₪) skips everything, including the parse call.
// 2. filtersKey: a different phrasing that the LLM parses into exactly the same filters reuses
//    the AliExpress results and explanations, so only the cheap parse call is paid.
// No fuzzy text matching: "עד 100" and "עד 150" are one character apart and must never share
// results. Reuse happens only when the filters that drive the results are identical.
// Prompt and ranking versions are part of the keys, so changing either never serves stale work.
import { createHash } from "node:crypto";
import { EXPLAIN_VERSION } from "@/lib/llm/explain";
import { PARSE_VERSION } from "@/lib/llm/parse";
import { fixSpelling } from "@/lib/llm/text-checks";
import { RANKING_VERSION, type ShopCapMode } from "@/lib/ranking/config";
import { normalizePhrase, tokenize } from "@/lib/ranking/match";
import type { ParsedQuery, SearchFilters } from "./filters";

/** How long parses and results are reused (owner decision 2026-09-27: 14 days, was 48h). */
export const CACHE_TTL_DAYS = 14;
export const CACHE_TTL_HOURS = CACHE_TTL_DAYS * 24;

const NIQQUD = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
// Currency words (standalone) → ₪. "שח" alone is also how people type ש״ח.
const CURRENCY = /(^|[\s,(])(ש["״”'׳]?ח|שקלים|שקל|nis|ils)(?=$|[\s.,!?:;)])/gi;
const PUNCTUATION = /[,.!?:;()[\]{}"'״׳“”„‘’«»\-–—־/\\|]+/g;

export function normalizeQuery(query: string): string {
  let q = query.normalize("NFKC").replace(NIQQUD, "").toLowerCase();
  // Currency first, while quotes inside ש״ח are still there.
  q = q.replace(CURRENCY, "$1₪");
  q = q.replace(PUNCTUATION, " ");
  // "100 ₪" and "₪ 100" → "₪100"
  q = q.replace(/(\d+(?:\.\d+)?)\s*₪/g, "₪$1").replace(/₪\s+(\d)/g, "₪$1");
  return q.replace(/\s+/g, " ").trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function queryKey(query: string): string {
  return sha256(`q2:p${PARSE_VERSION}:${normalizeQuery(query)}`);
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const sortedUnique = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();

const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];
/** A Hebrew label as explain reads it (explainContextFrom): known misspellings fixed. */
const label = (he: string) => fixSpelling(he.replace(/\s+/g, " ").trim());

/**
 * Everything that changes which products are fetched, kept, ordered and explained, normalized the
 * way the matcher reads it: "wireless charger" and "wireless charging" or "65 W" and "65w" are the
 * same requirement, so they share a key; product terms are compared as tokens, like the type gate.
 * Order counts where the code reads it: the first product term (relevance, broader keyword steps,
 * chip removal) and the first requirement's own phrase (keyword steps), so product terms and
 * requirements keep the parse's order and a requirement its en before its sorted alts. The
 * category hint (the last keyword step), the preference words (relevance) and the Hebrew labels
 * the explanations are written with (plan item 9: a label typed differently never shares another
 * query's lines) are part of the key too. Keyword words are a set: AliExpress ignores their order.
 * So is the shop cap mode the list is ranked under (the admin's setting, lib/settings): after a
 * switch, a list ranked under the other mode is never served, and the first searches fetch again.
 */
export function canonicalFilters(
  f: SearchFilters & Partial<Pick<ParsedQuery, "category_hint" | "product_he">>,
  shopCap: ShopCapMode,
) {
  const round = (n: number | undefined) => (n === undefined ? null : Math.round(n));
  return {
    rv: RANKING_VERSION,
    ev: EXPLAIN_VERSION,
    sc: shopCap,
    k: sortedUnique(words(f.keywords_en)),
    t: unique(f.product_terms.map((t) => tokenize(t).join(" "))),
    r: f.requirements.map((r) => [
      normalizePhrase(r.en),
      ...sortedUnique(r.alt.map(normalizePhrase)).filter((a) => a !== normalizePhrase(r.en)),
    ]),
    p: (f.preferences ?? []).map((p) => sortedUnique(p.words.map((w) => w.toLowerCase()))),
    h: words(f.category_hint ?? "").join(" "),
    l: [label(f.product_he ?? ""), ...f.requirements.map((r) => label(r.he))],
    min: round(f.min_price_ils),
    max: round(f.max_price_ils),
    s: f.sort_preference,
  };
}

export function filtersKey(
  f: SearchFilters & Partial<Pick<ParsedQuery, "category_hint" | "product_he">>,
  shopCap: ShopCapMode,
): string {
  return sha256(`f2:${JSON.stringify(canonicalFilters(f, shopCap))}`);
}

/**
 * How long a result set with no products is reused: the 48h of before the 14-day decision, so a
 * momentary gap in the AliExpress catalog does not say "nothing found" for two weeks. The same
 * holds for the parse of a search whose own filters found nothing (emptyParseCreatedAt in
 * ./pipeline.ts).
 */
export const EMPTY_RESULTS_TTL_HOURS = 48;

/**
 * How long a result set whose explain call failed (lines built from the data and AliExpress's
 * English titles, `degraded`) is reused: an hour, so the next searches after it get the Hebrew
 * titles and lines (2026-09-30: it was 48 h, and a Sonic search stayed in English for everyone).
 */
export const DEGRADED_RESULTS_TTL_HOURS = 1;

export function isFresh(createdAt: Date, now: Date, ttlHours: number = CACHE_TTL_HOURS): boolean {
  return now.getTime() - createdAt.getTime() < ttlHours * 3_600_000;
}

/**
 * Freshness of a cached result set: CACHE_TTL_HOURS, EMPTY_RESULTS_TTL_HOURS when it is empty, or
 * DEGRADED_RESULTS_TTL_HOURS when it is `degraded` (CachedResults.degraded).
 */
export function isFreshResults(
  createdAt: Date,
  productCount: number,
  now: Date,
  degraded = false,
): boolean {
  if (productCount > 0 && degraded) return isFresh(createdAt, now, DEGRADED_RESULTS_TTL_HOURS);
  return isFresh(createdAt, now, productCount === 0 ? EMPTY_RESULTS_TTL_HOURS : CACHE_TTL_HOURS);
}
