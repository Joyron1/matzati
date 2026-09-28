import { describe, expect, it } from "vitest";
import {
  firstParam,
  goHref,
  parseArrival,
  parseFrom,
  parseSort,
  parseWithout,
  searchHref,
} from "./search-url";

describe("searchHref", () => {
  it("omits empty values", () => {
    expect(searchHref({ q: "usb cable" })).toBe("/search?q=usb+cable");
    expect(searchHref({ q: "x", without: [] })).toBe("/search?q=x");
  });
  it("keeps an explicit sort, even best_value, since it overrides the parsed one", () => {
    expect(searchHref({ q: "x", sort: "best_value" })).toBe("/search?q=x&sort=best_value");
  });
  it("round-trips Hebrew queries and chip ids", () => {
    const href = searchHref({ q: "אוזניות עד 100 ש״ח", sort: "cheapest", without: ["req:65w"] });
    const params = new URL(href, "https://example.com").searchParams;
    expect(params.get("q")).toBe("אוזניות עד 100 ש״ח");
    expect(params.get("sort")).toBe("cheapest");
    expect(parseWithout(params.get("without") ?? undefined)).toEqual(["req:65w"]);
  });
  it("dedupes removed filters", () => {
    expect(searchHref({ q: "x", without: ["a", "a", "b"] })).toBe("/search?q=x&without=a%2Cb");
  });
  it("marks our own links to a query the visitor did not type", () => {
    expect(searchHref({ q: "x", from: "recent" })).toBe("/search?q=x&from=recent");
    expect(searchHref({ q: "x", from: "example" })).toBe("/search?q=x&from=example");
  });
});

describe("param parsing", () => {
  it("takes the first value of repeated params", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBe("");
  });
  it("returns no sort override for missing or unknown sorts", () => {
    expect(parseSort("cheapest")).toBe("cheapest");
    expect(parseSort("best_value")).toBe("best_value");
    expect(parseSort("price_desc")).toBeUndefined();
    expect(parseSort(undefined)).toBeUndefined();
  });
  it("splits, trims, dedupes and caps the removed-filter list", () => {
    expect(parseWithout(" a, ,b ,a")).toEqual(["a", "b"]);
    expect(parseWithout(undefined)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `id${i}`).join(",");
    expect(parseWithout(many)).toHaveLength(10);
  });
  it("accepts only known link origins", () => {
    expect(parseFrom("recent")).toBe("recent");
    expect(parseFrom(["example", "recent"])).toBe("example");
    expect(parseFrom("seo")).toBeUndefined();
    expect(parseFrom(undefined)).toBeUndefined();
  });
});

describe("parseArrival", () => {
  it("is an ad whenever an ad or campaign parameter is present", () => {
    expect(parseArrival({ q: "x", gclid: "abc" })).toBe("ad");
    expect(parseArrival({ q: "x", utm_source: "google", from: "example" })).toBe("ad");
    expect(parseArrival({ q: "x", gbraid: ["a", "b"] })).toBe("ad");
    expect(parseArrival({ q: "x", wbraid: "a" })).toBe("ad");
  });

  it("otherwise reads from, and is nothing for a query the visitor typed", () => {
    expect(parseArrival({ q: "x", from: "recent" })).toBe("recent");
    expect(parseArrival({ q: "x", from: "example" })).toBe("example");
    expect(parseArrival({ q: "x", utm_source: " " })).toBeUndefined();
    expect(parseArrival({ q: "x", from: "ad" })).toBeUndefined();
    expect(parseArrival({ q: "x" })).toBeUndefined();
  });
});

describe("goHref", () => {
  it("adds the search uid and position of a result card", () => {
    expect(goHref("1005", "search_featured", { searchUid: "abc", position: 1 })).toBe(
      "/go/1005?src=search_featured&s=abc&pos=1",
    );
  });

  it("leaves out what it does not have", () => {
    expect(goHref("1005", "product")).toBe("/go/1005?src=product");
    expect(goHref("1005", "seo", { searchUid: null, position: 3 })).toBe("/go/1005?src=seo&pos=3");
    expect(goHref("1005", "search_more", { searchUid: undefined })).toBe(
      "/go/1005?src=search_more",
    );
  });
});
