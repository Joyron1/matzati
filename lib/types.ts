// Wire types shared by the API and the UI. Field names follow the spec (snake_case JSON).

export type SortPreference = "best_value" | "cheapest" | "most_popular";

export type ChipKind = "keywords" | "must_have" | "min_price" | "max_price" | "category";

export interface FilterChip {
  id: string;
  kind: ChipKind;
  label_he: string;
  removable: boolean;
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
  image_urls: string[];
  category_id: string | null;
}

export interface SearchResponse {
  query: string;
  chips: FilterChip[];
  sort: SortPreference;
  checked_count: number;
  passed_count: number;
  results: ResultProduct[];
  more_available: boolean;
  /** Handle for "show 3 more" (results cache key). Absent on mock data. */
  filters_key?: string;
  /** True when served from the 14-day cache without new AliExpress or explain calls. */
  cached?: boolean;
  /**
   * When these results (and their prices) were fetched from AliExpress (ISO); older than the
   * response itself when served from the cache. Absent on mock data.
   */
  fetched_at?: string;
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

export interface Coupon {
  code: string;
  description_he: string;
  valid_until: string | null;
}

export interface CategoryTips {
  category_id: string;
  category_name_he: string;
  tips_he: string[];
}
