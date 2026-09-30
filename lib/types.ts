// Wire types shared by the API and the UI. Field names follow the spec (snake_case JSON).

export type SortPreference = "best_value" | "cheapest" | "most_popular";

export type ChipKind = "keywords" | "must_have" | "min_price" | "max_price" | "category";

export interface FilterChip {
  id: string;
  kind: ChipKind;
  label_he: string;
  removable: boolean;
}

/** Which of a card's numbers other listings of its shop show too (ResultProduct.shared_numbers). */
export interface SharedNumbersMark {
  /** Its positive feedback is the value the shop shows on most of its listings checked. */
  feedback: boolean;
  /** Another listing of the shop checked shows exactly its 30-day sales. */
  sales: boolean;
}

export interface ResultProduct {
  product_id: string;
  title_he: string;
  /** Original AliExpress title, shown for transparency. */
  title_en: string;
  why_he: string;
  price_ils: number;
  original_price_ils: number | null;
  /** True when the ILS price was converted from USD by us. */
  price_is_approx: boolean;
  discount_pct: number | null;
  /** From `evaluate_rate`. Null when AliExpress did not return it. */
  positive_feedback_pct: number | null;
  /** From `lastest_volume`: sales in the last 30 days (AliExpress docs), not lifetime. */
  units_sold: number | null;
  /** Trust thresholds the product meets (lib/ranking/config.ts); null when it meets neither. */
  passed_tier: "standard" | "fill" | null;
  /**
   * Its shop shows the same numbers on several listings of the checked pool
   * (lib/ranking/shared-numbers.ts), and which of this card's own numbers other listings of the
   * shop show too. The card still shows AliExpress's numbers and says which are shared; no line
   * states a shared number as the product's own, and no line of its page calls a product the
   * best-selling or best-rated one. Absent otherwise, and on results cached before the rule.
   */
  shared_numbers?: SharedNumbersMark;
  image_urls: string[];
  category_id: string | null;
}

/**
 * A removable filter that kept products out of a search showing fewer than 3 results
 * (lib/ranking/blockers.ts). Only the count is shown; a product that failed a filter never is.
 */
export interface FilterBlocker {
  /** The chip that removes it (FilterChip.id), for the usual without= link. */
  chip_id: string;
  /** Checked products that pass every other filter: "Y עברו" without this one. */
  would_pass: number;
  /** A requirement only: checked products whose title mentions it at all; null for a price. */
  title_matches: number | null;
  /**
   * A capacity requirement of a "small" search: products that state a capacity over the size cap
   * (SMALL_CAPACITY_FACTOR) fail it too, so "no title mentions it" may be false. Absent otherwise.
   */
  size_cap?: true;
}

export interface SearchResponse {
  query: string;
  chips: FilterChip[];
  sort: SortPreference;
  checked_count: number;
  passed_count: number;
  /** The first page (RESULTS_PER_PAGE), each with its "why we picked it" line. */
  results: ResultProduct[];
  /**
   * Places 6-10 of the first view (RESULTS_FIRST_VIEW, owner decision 2026-09-30): standard cards
   * with a Hebrew title (lib/llm/titles.ts, or AliExpress's title when that call failed) and no line
   * (why_he is ""). Absent on mock data and older responses.
   */
  extra_results?: ResultProduct[];
  /**
   * Products after `results` (places 6 and up): the WhatsApp bot's "עוד" (page 1 of loadMore). The
   * results page reads more_after_first_view.
   */
  more_available: boolean;
  /**
   * Products after the first view (places 11 and up): /search's "עוד N אפשרויות", from page
   * FIRST_MORE_PAGE of loadMore. Absent on mock data and older responses.
   */
  more_after_first_view?: boolean;
  /** Handle for "עוד N אפשרויות" (results cache key). Absent on mock data. */
  filters_key?: string;
  /** True when served from the 14-day cache without new AliExpress or explain calls. */
  cached?: boolean;
  /**
   * When these results (and their prices) were fetched from AliExpress (ISO); older than the
   * response itself when served from the cache. Absent on mock data.
   */
  fetched_at?: string;
  /**
   * With fewer than 3 results: the filters whose removal lets more of the checked products
   * through, most useful first ([] when none would). Absent with 3 or more results, and on
   * results cached before it existed.
   */
  blockers?: FilterBlocker[];
  /**
   * Hebrew labels of stated needs that are not filters (SearchFilters.preferences): titles that
   * mention them rank higher, and the page says they were not checked. Absent when there are none.
   */
  not_filtered?: string[];
}

export type DealType = "deal" | "holiday" | "dont_buy";

export interface Deal {
  id: string;
  type: DealType;
  title: string;
  body: string;
  product_id: string | null;
  coupon_code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /** Only published deals are public (RLS: anon may select published = true). */
  published: boolean;
  created_at: string;
}

/** Fields an admin edits; id, published and created_at are managed separately. */
export type DealInput = Omit<Deal, "id" | "published" | "created_at">;

export interface CategoryTips {
  category_id: string;
  category_name_he: string;
  tips_he: string[];
}
