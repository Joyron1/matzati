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
}

/** Everything that decides which products are fetched, kept and ordered. */
export interface SearchFilters {
  /** 2-4 English words sent to the AliExpress keyword search. */
  keywords_en: string;
  /** 1-4 lowercase phrases naming the product itself: ["phone holder", "phone mount"]. */
  product_terms: string[];
  requirements: Requirement[];
  min_price_ils?: number;
  max_price_ils?: number;
  sort_preference: SortPreference;
}

/** Parse output: the filters plus labels and hints that do not change results. */
export interface ParsedQuery extends SearchFilters {
  /** Hebrew label for the product chip: "אוזניות לריצה". */
  product_he: string;
  /** Broader English category, used by the keyword fallback ladder. */
  category_hint?: string;
}
