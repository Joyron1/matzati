import { describe, expect, it } from "vitest";
import { firstParam, parseSort, parseWithout, searchHref } from "./search-url";

describe("searchHref", () => {
  it("omits defaults", () => {
    expect(searchHref({ q: "usb cable" })).toBe("/search?q=usb+cable");
    expect(searchHref({ q: "x", sort: "best_value", without: [] })).toBe("/search?q=x");
  });
  it("round-trips Hebrew queries", () => {
    const href = searchHref({ q: "אוזניות עד 100 ש״ח", sort: "cheapest", without: ["max-price"] });
    const params = new URL(href, "https://example.com").searchParams;
    expect(params.get("q")).toBe("אוזניות עד 100 ש״ח");
    expect(params.get("sort")).toBe("cheapest");
    expect(params.get("without")).toBe("max-price");
  });
  it("dedupes removed filters", () => {
    expect(searchHref({ q: "x", without: ["a", "a", "b"] })).toBe("/search?q=x&without=a%2Cb");
  });
});

describe("param parsing", () => {
  it("takes the first value of repeated params", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBe("");
  });
  it("falls back to best_value for unknown sorts", () => {
    expect(parseSort("cheapest")).toBe("cheapest");
    expect(parseSort("price_desc")).toBe("best_value");
    expect(parseSort(undefined)).toBe("best_value");
  });
  it("splits and trims the removed-filter list", () => {
    expect(parseWithout(" a, ,b ")).toEqual(["a", "b"]);
    expect(parseWithout(undefined)).toEqual([]);
  });
});
