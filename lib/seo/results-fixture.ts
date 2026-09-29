// Made-up SEO page results for tests (lib/seo/*.test.ts): products that pass, groups of five with
// the states asked for. No real product, nothing from AliExpress or an LLM.
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { EXPLAIN_VERSION, type ExplainContext } from "@/lib/llm/explain";
import type { ResultProduct } from "@/lib/types";
import {
  chunk,
  SEO_RESULTS_VERSION,
  withoutLines,
  type GroupState,
  type SeoResults,
} from "./results";

export const FIXTURE_QUERY = "אוזניות אלחוטיות";
export const FIXTURE_IMAGE = "https://ae01.alicdn.aliexpress-media.com/kf/a.jpg";

export const FIXTURE_CONTEXT: ExplainContext = {
  product_he: "אוזניות אלחוטיות",
  requirements_he: [],
  sort_preference: "best_value",
};

export function fixtureProduct(i: number): ResultProduct {
  return {
    product_id: `100500${String(i).padStart(3, "0")}`,
    title_he: `אוזניות ${i}`,
    title_en: `Wireless Earbuds ${i}`,
    why_he: `אוזניות אלחוטיות עם משוב חיובי גבוה ומכירות רבות, דגם ${i}.`,
    price_ils: 50 + i,
    original_price_ils: null,
    price_is_approx: false,
    discount_pct: null,
    positive_feedback_pct: 96,
    units_sold: 1200 + i,
    passed_tier: "standard",
    image_urls: [FIXTURE_IMAGE],
    category_id: "44",
  };
}

/**
 * `count` products in groups of five; `states` gives each group's state (the rest "model"). A
 * pending group's products carry no lines, as a run stores them.
 */
export function fixtureResults(
  count: number,
  {
    states = [],
    full = true,
    fetchedAt = "2026-09-28T10:00:00.000Z",
    offset = 0,
    query = FIXTURE_QUERY,
  }: {
    states?: GroupState[];
    full?: boolean;
    fetchedAt?: string;
    offset?: number;
    query?: string;
  } = {},
): SeoResults {
  const products = Array.from({ length: count }, (_, i) => fixtureProduct(i + 1 + offset));
  const groups = chunk(
    products.map((p) => p.product_id),
    RESULTS_PER_PAGE,
  ).map((ids, i) => ({
    ids,
    state: states[i] ?? ("model" as GroupState),
  }));
  const pending = new Set(groups.flatMap((g) => (g.state === "pending" ? g.ids : [])));
  return {
    v: SEO_RESULTS_VERSION,
    query,
    chips: [{ id: "keywords", kind: "keywords", label_he: query, removable: false }],
    sort: "best_value",
    checked_count: 200,
    passed_count: count + 7,
    fetched_at: fetchedAt,
    full,
    context: FIXTURE_CONTEXT,
    explain_version: EXPLAIN_VERSION,
    results: products.map((p) => (pending.has(p.product_id) ? withoutLines(p) : p)),
    groups,
  };
}
