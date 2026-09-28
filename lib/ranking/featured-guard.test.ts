import { describe, expect, it } from "vitest";
import { demoteFlaggedLeads, explanationSaysNotProduct } from "./featured-guard";

describe("explanationSaysNotProduct", () => {
  it("flags the recorded partial-fit line of the car tray", () => {
    // search_cache 12eebefd82 (docs/search-quality-plan.md, appendix): result #3's why_he.
    expect(
      explanationSaysNotProduct(
        "אביזר משלים, לא מארגן מגירות ביתי: תא אחסון מתחת למושב הרכב.",
        "מארגן למגירות",
      ),
    ).toBe(true);
  });

  it("flags 'לא <product_he>' with or without the article", () => {
    expect(explanationSaysNotProduct("כרית לרכב, לא כרית צוואר לטיסות.", "כרית צוואר לטיסות")).toBe(
      true,
    );
    expect(explanationSaysNotProduct("מעמד בלבד, לא הסאונד בר עצמו.", "סאונד בר")).toBe(true);
    // Niqqud and maqaf do not hide it.
    expect(explanationSaysNotProduct("לֹא סאונד־בר, מעמד בלבד.", "סאונד־בר")).toBe(true);
  });

  it("does not flag an ordinary line", () => {
    expect(
      explanationSaysNotProduct("מארגן מגירות מתכוונן עם 6 תאים, 98% משוב חיובי.", "מארגן למגירות"),
    ).toBe(false);
    expect(explanationSaysNotProduct("לא דורש סוללות, נטען ב־USB.", "מנורת לילה")).toBe(false);
    expect(explanationSaysNotProduct("כל שורה", "")).toBe(false);
  });
});

describe("demoteFlaggedLeads", () => {
  const shop = (id: string | null) => ({ id, name: null, url: null });
  const list = ["a", "b", "c", "d", "e"].map((productId) => ({ productId, shop: shop(null) }));
  const why = (text: string) => ({ why_he: text });

  it("keeps the list's shop cap on the first page after moving one out", () => {
    // A first page of 5 with two of shop A; next come A again and E. B is flagged.
    const shops = [
      { productId: "a1", shop: shop("A") },
      { productId: "a2", shop: shop("A") },
      { productId: "b1", shop: shop("B") },
      { productId: "c1", shop: shop("C") },
      { productId: "d1", shop: shop("D") },
      { productId: "a3", shop: shop("A") },
      { productId: "e1", shop: shop("E") },
    ];
    const flagged = { b1: why("אביזר משלים, לא רמקול: מעמד.") };
    const order = (mode: "none" | "max2") =>
      demoteFlaggedLeads(shops, flagged, "רמקול בלוטוס", 5, mode).ranked.map((p) => p.productId);
    // "max2": a third of A may not move up, so E does.
    expect(order("max2")).toEqual(["a1", "a2", "c1", "d1", "e1", "a3", "b1"]);
    // "none": the next in the ranking's order moves up, whatever its shop.
    expect(order("none")).toEqual(["a1", "a2", "c1", "d1", "a3", "e1", "b1"]);
  });

  it("moves a flagged first-page product to the end, so the next one moves up", () => {
    const { ranked, demoted } = demoteFlaggedLeads(
      list,
      { a: why("טוב."), b: why("אביזר משלים, לא מארגן מגירות: מגש לרכב."), c: why("טוב.") },
      "מארגן למגירות",
      3,
      "none",
    );
    expect(ranked.map((p) => p.productId)).toEqual(["a", "c", "d", "e", "b"]);
    expect(demoted).toEqual(["b"]);
  });

  it("reads the first page only and drops nothing", () => {
    const { ranked, demoted } = demoteFlaggedLeads(
      list,
      { d: why("אביזר משלים, לא מארגן מגירות.") },
      "מארגן למגירות",
      3,
      "none",
    );
    expect(ranked.map((p) => p.productId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(demoted).toEqual([]);
  });

  it("keeps the order of several flagged products and ignores a missing explanation", () => {
    const { ranked } = demoteFlaggedLeads(
      list,
      { a: why("אביזר משלים: רצועה."), c: why("אביזר משלים: כיסוי.") },
      "שעון חכם",
      3,
      "max2",
    );
    expect(ranked.map((p) => p.productId)).toEqual(["b", "d", "e", "a", "c"]);
  });
});
