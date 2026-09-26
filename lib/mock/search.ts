// M1 mock of the /api/search response. Replaced by the real pipeline in M4.
import type { FilterChip, ResultProduct, SearchResponse, SortPreference } from "@/lib/types";
import { MOCK_PRODUCTS } from "./products";

export const EXAMPLE_QUERY = "אוזניות לריצה, עמידות למים, עד 100 ש״ח";

const EXAMPLE_CHIPS: FilterChip[] = [
  { id: "keywords", kind: "keywords", label_he: "אוזניות לריצה", removable: false },
  { id: "must-waterproof", kind: "must_have", label_he: "עמידות למים", removable: true },
  { id: "max-price", kind: "max_price", label_he: "עד ₪100", removable: true },
];

// How many more products "pass" when a chip is removed (sample numbers).
const EXTRA_PASSED: Record<string, number> = { "must-waterproof": 8, "max-price": 17 };

function sortProducts(products: ResultProduct[], sort: SortPreference): ResultProduct[] {
  const copy = [...products];
  if (sort === "cheapest") copy.sort((a, b) => a.price_ils - b.price_ils);
  if (sort === "most_popular") copy.sort((a, b) => (b.units_sold ?? 0) - (a.units_sold ?? 0));
  return copy;
}

export interface MockSearchInput {
  q: string;
  without: string[];
  sort: SortPreference;
  empty?: boolean;
}

export interface MockSearchResult {
  response: SearchResponse;
  more: ResultProduct[];
}

export function getMockSearch({ q, without, sort, empty }: MockSearchInput): MockSearchResult {
  const baseChips: FilterChip[] =
    q === EXAMPLE_QUERY
      ? EXAMPLE_CHIPS
      : [{ id: "keywords", kind: "keywords", label_he: q.slice(0, 40), removable: false }];
  const chips = baseChips.filter((c) => !without.includes(c.id));

  if (empty) {
    return {
      response: {
        query: q,
        chips,
        sort,
        checked_count: 100,
        passed_count: 0,
        results: [],
        more_available: false,
      },
      more: [],
    };
  }

  const ordered = sortProducts(MOCK_PRODUCTS, sort);
  const passed = 6 + without.reduce((sum, id) => sum + (EXTRA_PASSED[id] ?? 0), 0);
  return {
    response: {
      query: q,
      chips,
      sort,
      checked_count: 100,
      passed_count: passed,
      results: ordered.slice(0, 3),
      more_available: true,
    },
    more: ordered.slice(3, 6),
  };
}
