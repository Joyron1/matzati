import { describe, expect, it } from "vitest";
import { stripEvent } from "./vercel-analytics";

describe("stripEvent", () => {
  it("drops the query string, so the search text never reaches Vercel", () => {
    expect(
      stripEvent({
        type: "pageview",
        url: "https://www.matzati-il.com/search?q=שעון%20חכם&sort=cheapest",
      }),
    ).toEqual({ type: "pageview", url: "https://www.matzati-il.com/search" });
  });

  it("drops the hash and keeps the path", () => {
    expect(
      stripEvent({ type: "pageview", url: "https://www.matzati-il.com/terms#affiliate" })?.url,
    ).toBe("https://www.matzati-il.com/terms");
  });

  it("does not count admin or dev pages", () => {
    expect(
      stripEvent({ type: "pageview", url: "https://www.matzati-il.com/admin/seo" }),
    ).toBeNull();
    expect(
      stripEvent({ type: "pageview", url: "https://www.matzati-il.com/dev/preview/x" }),
    ).toBeNull();
    expect(
      stripEvent({ type: "pageview", url: "https://www.matzati-il.com/administration" }),
    ).not.toBeNull();
  });

  it("drops an event whose URL cannot be read", () => {
    expect(stripEvent({ type: "pageview", url: "not a url" })).toBeNull();
  });
});
