import { describe, expect, it } from "vitest";
import { productLabelOf, uniqueByProduct } from "./display";
import type { RecentSearch } from "./types";

const search = (query: string, product: string | null): RecentSearch => ({
  queryNorm: query,
  query,
  chips: [
    ...(product !== null
      ? [{ id: "product", kind: "keywords" as const, label_he: product, removable: false }]
      : []),
    { id: "max", kind: "max_price", label_he: "עד ₪100", removable: true },
  ],
  categoryId: "26",
  categoryHe: "צעצועים ומוצרי תחביב",
  images: [],
  resultsCount: 3,
  searchedAt: "2026-09-27T18:00:00.000Z",
});

describe("productLabelOf", () => {
  it("is the product chip, not the query", () => {
    expect(productLabelOf(search("בובת סוניק לילד שלי בן 5", "בובת סוניק"))).toBe("בובת סוניק");
  });

  it("is null without a product chip or with an empty one", () => {
    expect(productLabelOf(search("משהו", null))).toBeNull();
    expect(productLabelOf(search("משהו", "  "))).toBeNull();
  });
});

describe("uniqueByProduct", () => {
  it("keeps the newest search per product label, in order, up to the limit", () => {
    const list = [
      search("בובת סוניק לילד", "בובת סוניק"),
      search("סאונד בר", "סאונד בר"),
      search("בובת סוניק", "בובת  סוניק"),
      search("משהו", null),
      search("תיק גב לטיולים", "תיק גב"),
      search("אוזניות לריצה", "אוזניות לריצה"),
    ];
    expect(uniqueByProduct(list, 3).map((s) => s.query)).toEqual([
      "בובת סוניק לילד",
      "סאונד בר",
      "תיק גב לטיולים",
    ]);
    expect(uniqueByProduct(list, 10)).toHaveLength(4);
  });
});
