// The results an SEO landing page (/s/[slug]) stores and shows (owner decision 2026-09-29): every
// product of its query that passed the filters, in ranked order, up to SEO_MAX_PRODUCTS, in groups
// of RESULTS_PER_PAGE. Each group is one explain call, so a line's comparison ("הזול מבין
// החמישה") is about its own five. A group whose call has not run yet (no time left, the call
// failed, the daily budget) is "pending": it is kept with its products and explained by the next
// refresh, and the page shows only the groups before the first pending one. Pure: shared by the
// refresh (lib/search/seo-run.ts), the stored snapshot (./snapshot.ts) and the page.
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { whyFromData, type ExplainContext, type ExplainInput } from "@/lib/llm/explain";
import type { FilterChip, ResultProduct, SearchResponse, SortPreference } from "@/lib/types";

/** The shape version of seo_pages.results written by this code (1 was a SearchResponse). */
export const SEO_RESULTS_VERSION = 2;

/**
 * seo_pages_results_shape (20260929010000_seo_snapshots.sql): octet_length(results::text) at most
 * 256 KB. What we write stays well under it (SNAPSHOT_BUDGET_BYTES, fitForStorage).
 */
export const SNAPSHOT_LIMIT_BYTES = 262_144;
/** What a write may take of the limit, leaving room for the database's own formatting. */
export const SNAPSHOT_BUDGET_BYTES = 240_000;

/**
 * "model": explained by its own explain call. "data": shown with the lines built from the data
 * and AliExpress's titles (only the first group of a page that had nothing else to show, after a
 * failed call). "pending": not explained yet, not shown.
 */
export type GroupState = "model" | "data" | "pending";

export interface SeoGroup {
  /** The group's products in page order. */
  ids: string[];
  state: GroupState;
}

export interface SeoResults {
  v: typeof SEO_RESULTS_VERSION;
  query: string;
  chips: FilterChip[];
  sort: SortPreference;
  checked_count: number;
  /** Every product that passed, also those past SEO_MAX_PRODUCTS. */
  passed_count: number;
  not_filtered?: string[];
  /** When the products were fetched from AliExpress (ISO). */
  fetched_at: string;
  /**
   * True for a refresh's collection (up to SEO_MAX_PRODUCTS); false for the one page of a first
   * render (a visitor's search, at most RESULTS_PER_PAGE), which the next cron run replaces.
   */
  full: boolean;
  /** What the explain calls were given; null when the lines cannot be continued (older shapes). */
  context: ExplainContext | null;
  /** EXPLAIN_VERSION the lines were written under: another version never reuses them. */
  explain_version: number;
  /** Every product in ranked order, only the fields the page renders (leanProduct). */
  results: ResultProduct[];
  groups: SeoGroup[];
}

/** seo_pages.results: the results shown, and a newer run still being explained (see refresh.ts). */
export interface StoredSeoResults extends SeoResults {
  next?: SeoResults;
}

/** `ids` in groups of RESULTS_PER_PAGE. */
export function chunk<T>(items: readonly T[], size: number = RESULTS_PER_PAGE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function byId(r: Pick<SeoResults, "results">): Map<string, ResultProduct> {
  return new Map(r.results.map((p) => [p.product_id, p]));
}

/** The groups the page shows: every group before the first pending one, as products. */
export function shownGroups(r: Pick<SeoResults, "results" | "groups">): ResultProduct[][] {
  const products = byId(r);
  const out: ResultProduct[][] = [];
  for (const g of r.groups) {
    if (g.state === "pending") break;
    const group = g.ids.flatMap((id) => products.get(id) ?? []);
    if (group.length) out.push(group);
  }
  return out;
}

export function shownCount(r: Pick<SeoResults, "results" | "groups">): number {
  return shownGroups(r).reduce((n, g) => n + g.length, 0);
}

/** Groups still to be explained (pending, or shown with the lines from the data). */
export function groupsToExplain(r: Pick<SeoResults, "groups">): number {
  return r.groups.filter((g) => g.state !== "model").length;
}

/** A later refresh can write the missing lines without fetching again. */
export function canContinue(r: SeoResults): boolean {
  return r.context !== null && groupsToExplain(r) > 0;
}

/** Only what the page renders: one photo (the cards and the ItemList use the first). */
export function leanProduct(p: ResultProduct): ResultProduct {
  return { ...p, image_urls: p.image_urls.slice(0, 1) };
}

/** The explain step's view of a stored product (the numbers the card shows). */
export function explainInputOf(p: ResultProduct): ExplainInput {
  return {
    product_id: p.product_id,
    title_en: p.title_en,
    price_ils: p.price_ils,
    original_price_ils: p.original_price_ils,
    discount_pct: p.discount_pct,
    positive_feedback_pct: p.positive_feedback_pct,
    units_sold_30d: p.units_sold,
    ...(p.shared_numbers ? { shared_numbers: p.shared_numbers } : {}),
  };
}

/** A product with no line of ours: AliExpress's title, no line (a pending group). */
export function withoutLines(p: ResultProduct): ResultProduct {
  return { ...p, title_he: p.title_en, why_he: "" };
}

/**
 * The first group shown with the lines built from the data and AliExpress's titles: a page that
 * has nothing else to show after its first explain call failed (as a search shows a failed
 * explain call). The next refresh explains it.
 */
export function withDataLead(r: SeoResults): SeoResults {
  const [first, ...rest] = r.groups;
  if (!first) return r;
  const lead = new Set(first.ids);
  return {
    ...r,
    results: r.results.map((p) =>
      lead.has(p.product_id)
        ? { ...p, title_he: p.title_en, why_he: whyFromData(explainInputOf(p)) }
        : p,
    ),
    groups: [{ ...first, state: "data" }, ...rest],
  };
}

/**
 * A visitor's search response (the first render of a page without stored results, or a snapshot
 * stored before this shape) as one group of the page: its lines were written by one call.
 */
export function fromSearchResponse(
  response: SearchResponse,
  { degraded = false, explainVersion = 0 }: { degraded?: boolean; explainVersion?: number } = {},
): SeoResults {
  const results = response.results.slice(0, RESULTS_PER_PAGE).map(leanProduct);
  return {
    v: SEO_RESULTS_VERSION,
    query: response.query,
    chips: response.chips,
    sort: response.sort,
    checked_count: response.checked_count,
    passed_count: response.passed_count,
    ...(response.not_filtered?.length ? { not_filtered: response.not_filtered } : {}),
    fetched_at: response.fetched_at ?? new Date(0).toISOString(),
    full: false,
    context: null,
    explain_version: explainVersion,
    results,
    groups: results.length
      ? [{ ids: results.map((p) => p.product_id), state: degraded ? "data" : "model" }]
      : [],
  };
}

const encoder = new TextEncoder();
const utf8Bytes = (s: string) => encoder.encode(s).length;

/**
 * About octet_length(value::text) of the jsonb Postgres stores: its text form puts a space after
 * every ":" and ",", which JSON.stringify leaves out.
 */
export function jsonbTextBytes(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (Array.isArray(value)) {
    const items = value.map(jsonbTextBytes);
    return 2 + items.reduce((a, b) => a + b, 0) + Math.max(0, items.length - 1) * 2;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    const inner = entries.reduce(
      (n, [k, v]) => n + utf8Bytes(JSON.stringify(k)) + 2 + jsonbTextBytes(v),
      0,
    );
    return 2 + inner + Math.max(0, entries.length - 1) * 2;
  }
  return utf8Bytes(JSON.stringify(value));
}

/**
 * What a write stores, within SNAPSHOT_BUDGET_BYTES: first without the run still being explained
 * (`next`), then without the last groups, never below one group. Measured, 50 products take about
 * 40 KB (55 KB with the longest titles and lines, 110 KB with a waiting run of 50 beside them),
 * so this only guards against an unexpected shape.
 */
export function fitForStorage(stored: StoredSeoResults): StoredSeoResults {
  let out = stored;
  if (jsonbTextBytes(out) <= SNAPSHOT_BUDGET_BYTES) return out;
  if (out.next) {
    const rest = { ...out };
    delete rest.next;
    out = rest;
  }
  while (jsonbTextBytes(out) > SNAPSHOT_BUDGET_BYTES && out.groups.length > 1) {
    const groups = out.groups.slice(0, -1);
    const kept = new Set(groups.flatMap((g) => g.ids));
    out = { ...out, groups, results: out.results.filter((p) => kept.has(p.product_id)) };
  }
  return out;
}
