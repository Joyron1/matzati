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
}

/** Parse output: the filters plus labels and hints that do not change results. */
export interface ParsedQuery extends SearchFilters {
  /** Hebrew label for the product chip: "אוזניות לריצה". */
  product_he: string;
  /** Broader English category, used by the keyword fallback ladder. */
  category_hint?: string;
}
