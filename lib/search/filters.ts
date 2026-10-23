// Shared contract between parse (LLM job a), ranking, explain (LLM job b), the cache and the UI.
// Owner decision 2026-09-27: filters carry product_terms and AND-ed requirements so the code can
// enforce what the user asked for (CLAUDE.md §6.3, revised).

export type SortPreference = "best_value" | "cheapest" | "most_popular";

/** One hard requirement the user stated. A product must satisfy every requirement. */
export interface Requirement {
  /** Seller phrase as it appears in English titles, lowercase: "waterproof", "heart rate", "65w". */
  en: string;
  /** 0-3 other seller phrasings of the same requirement: ["water resistant", "ipx"]. */
  alt: string[];
  /** Short Hebrew chip label: "עמידות למים". */
  he: string;
  /**
   * Phrases a title must NOT say for the requirement to hold (category rules, 2026-10-23: real gold
   * is never "plated"). Set by code (lib/search/category-rules.ts), never by the parse.
   */
  not?: string[];
}

/**
 * A need the user stated that no title check can verify ("לטלפון ולמחשב נייד", parsed as
 * "multi-device"; docs/search-quality-plan.md item 8). Not a filter: titles with its words only
 * rank higher (lib/ranking/relevance.ts), and the results page says it was not checked.
 */
export interface Preference {
  /** Lowercase English words a title may say it with: ["laptop", "phone"]. */
  words: string[];
  /** The Hebrew label of the stated need, as the chip would have shown it. */
  he: string;
}

/** Everything that decides which products are fetched, kept and ordered. */
export interface SearchFilters {
  /** 2-4 English words sent to the AliExpress keyword search. */
  keywords_en: string;
  /** 1-4 lowercase phrases naming the product itself: ["phone holder", "phone mount"]. */
  product_terms: string[];
  requirements: Requirement[];
  /** Stated needs that are not filters (see Preference); absent when there are none. */
  preferences?: Preference[];
  min_price_ils?: number;
  max_price_ils?: number;
  sort_preference: SortPreference;
  /**
   * A first-level AliExpress category the search is limited to (/search?cat=, the search box of a
   * /products category page; owner request 2026-10-03). Set by code from a validated id
   * (parseSearchCategory in lib/search-url.ts), never by the parse, and never stored in the parse
   * cache: the same query parses the same with or without it. Sent to product.query as
   * category_ids and part of the results cache key when set.
   */
  category_id?: string;
  /**
   * The child's age a toy or kids search states ("לילד בן 5"; lib/search/category-rules.ts): a
   * title stating an older minimum age fails (lib/ranking/age.ts). Set by code, never by the parse.
   */
  child_age?: number;
}

/** Parse output: the filters plus labels and hints that do not change results. */
export interface ParsedQuery extends SearchFilters {
  /** Hebrew label for the product chip: "אוזניות לריצה". */
  product_he: string;
  /** Broader English category, used by the keyword fallback ladder. */
  category_hint?: string;
  /**
   * The AliExpress first-level categories the parse assigned (owner request 2026-10-23; at most 2,
   * lib/search/categories.ts). The fetch sends them as category_ids until too few pass, then drops
   * them (lib/search/fetch-policy.ts); a page's own category (category_id) wins. Part of the
   * results cache key.
   */
  category_guess?: string[];
  /** What the category rules did, said under the chips (Hebrew; lib/search/category-rules.ts). */
  category_notes?: string[];
}
