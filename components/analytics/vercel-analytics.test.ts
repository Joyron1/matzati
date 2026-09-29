import { describe, expect, it } from "vitest";
import { stripEvent } from "./vercel-analytics";

describe("stripEvent", () => {
  it("drops the query string, so the search text never reaches Vercel", () => {
    expect(
      stripEvent({
        type: "pageview",
        url: "https://matzati-il.vercel.app/search?q=שעון%20חכם&sort=cheapest",
      }),
    ).toEqual({ type: "pageview", url: "https://matzati-il.vercel.app/search" });
  });

  it("drops the hash and keeps the path", () => {
    expect(
      stripEvent({ type: "pageview", url: "https://matzati-il.vercel.app/terms#affiliate" })?.url,
    ).toBe("https://matzati-il.vercel.app/terms");
  });

  it("does not count admin or dev pages", () => {
    expect(
      stripEvent({ type: "pageview", url: "https://matzati-il.vercel.app/admin/seo" }),
    ).toBeNull();
    expect(
      stripEvent({ type: "pageview", url: "https://matzati-il.vercel.app/dev/preview/x" }),
    ).toBeNull();
    expect(
      stripEvent({ type: "pageview", url: "https://matzati-il.vercel.app/administration" }),
    ).not.toBeNull();
  });

  it("drops an event whose URL cannot be read", () => {
    expect(stripEvent({ type: "pageview", url: "not a url" })).toBeNull();
  });
});
