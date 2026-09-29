import { describe, expect, it } from "vitest";
import { buildSitemap, STATIC_PATHS } from "./sitemap";

const ORIGIN = "https://www.matzati-il.com";

describe("buildSitemap", () => {
  it("lists home and the static pages, without /deals when there are no deals", () => {
    const urls = buildSitemap({ origin: ORIGIN, hasDeals: false, pages: [] }).map((e) => e.url);
    expect(urls).toEqual([ORIGIN, ...STATIC_PATHS.map((p) => `${ORIGIN}${p}`)]);
    expect(urls).not.toContain(`${ORIGIN}/deals`);
  });

  it("lists the four legal pages and not /disclosure, which only redirects", () => {
    const urls = buildSitemap({ origin: ORIGIN, hasDeals: false, pages: [] }).map((e) => e.url);
    for (const path of ["/terms", "/privacy", "/cookies", "/accessibility"]) {
      expect(urls).toContain(`${ORIGIN}${path}`);
    }
    expect(urls).not.toContain(`${ORIGIN}/disclosure`);
  });

  it("lists /deals while a published deal exists", () => {
    const urls = buildSitemap({ origin: ORIGIN, hasDeals: true, pages: [] }).map((e) => e.url);
    expect(urls).toContain(`${ORIGIN}/deals`);
  });

  it("lists every landing page with an encoded URL and its updated_at", () => {
    const entries = buildSitemap({
      origin: ORIGIN,
      hasDeals: false,
      pages: [
        { slug: "אוזניות-לריצה", updated_at: "2026-09-27T12:30:00.000Z" },
        { slug: "usb-c", updated_at: "2026-09-26T08:00:00.000Z" },
      ],
    });
    const seo = entries.filter((e) => e.url.includes("/s/"));
    expect(seo).toEqual([
      {
        url: `${ORIGIN}/s/${encodeURIComponent("אוזניות-לריצה")}`,
        lastModified: "2026-09-27T12:30:00.000Z",
        changeFrequency: "daily",
        priority: 0.8,
      },
      {
        url: `${ORIGIN}/s/usb-c`,
        lastModified: "2026-09-26T08:00:00.000Z",
        changeFrequency: "daily",
        priority: 0.8,
      },
    ]);
    // Only characters that are valid in a sitemap <loc> without escaping.
    for (const e of entries) expect(e.url).toMatch(/^https:\/\/[A-Za-z0-9.\-/%]+$/);
  });

  it("never lists private or non-indexed routes, and no duplicates", () => {
    const urls = buildSitemap({
      origin: ORIGIN,
      hasDeals: true,
      pages: [
        { slug: "abc", updated_at: "2026-09-27T12:30:00.000Z" },
        { slug: "abc", updated_at: "2026-09-27T12:30:00.000Z" },
      ],
    }).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url).not.toMatch(/\/(admin|api|go|search)(\/|$|\?)/);
    }
  });
});
