// The first page of results shows complete, at once (the waiting screen covers the time the lines
// take): every card with its Hebrew title and line, never a placeholder, laid out for any page size.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LoggedResult } from "@/lib/search-url";
import { ResultCards } from "./result-cards";

const result = (i: number): LoggedResult => ({
  product_id: `100500${i}`,
  title_he: `כבל טעינה ${i}`,
  title_en: `USB C Cable ${i}00W Fast Charging`,
  why_he: `כבל שנמכר הרבה בחודש האחרון, עם משוב טוב (${i}).`,
  price_ils: 10 + i,
  original_price_ils: null,
  price_is_approx: false,
  discount_pct: null,
  positive_feedback_pct: 98,
  units_sold: i * 1000,
  passed_tier: "standard",
  image_urls: [],
  category_id: "44",
  search_uid: "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10",
});

/** Hebrew text as React writes it into HTML (no entities for these letters). */
const html = (results: LoggedResult[]) =>
  renderToStaticMarkup(createElement(ResultCards, { results, q: "כבל USB" })).replace(
    /<!-- -->/g,
    "",
  );

describe("ResultCards", () => {
  it("renders every card complete, with its title, line and /go link, and no placeholder", () => {
    const results = [1, 2, 3].map(result);
    const out = html(results);
    for (const r of results) {
      expect(out).toContain(r.title_he);
      expect(out).toContain(r.why_he);
      expect(out).toContain(`/go/${r.product_id}`);
    }
    expect(out).not.toContain("כותבים");
    expect(out).not.toMatch(/min-h-\[\d/);
    expect(out).toContain("מקום 1 בדירוג");
    expect(out).toContain("מקום 3 בדירוג");
  });

  it("keeps up to two compact cards in one column beside the featured card", () => {
    const out = html([1, 2, 3].map(result));
    expect(out).toContain("lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]");
    expect(out).not.toContain("sm:grid-cols-2");
  });

  it("lays out a page of five: the featured card across, the compact cards in two columns", () => {
    const results = [1, 2, 3, 4, 5].map(result);
    const out = html(results);
    expect(out).not.toContain("lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]");
    expect(out).toContain("sm:grid-cols-2");
    // The featured card puts its photo beside its text when it has the room.
    expect(out).toContain("@2xl:grid-cols-2");
    for (const r of results) expect(out).toContain(r.title_he);
    expect(out).toContain("מקום 5 בדירוג");
  });

  it("shows AliExpress's English title left to right when there is no Hebrew one", () => {
    const english = { ...result(2), title_he: "USB C Cable 200W Fast Charging" };
    const out = html([result(1), english]);
    expect(out).toContain(
      `<span dir="ltr" lang="en" class="text-end line-clamp-2">${english.title_he}</span>`,
    );
  });
});
