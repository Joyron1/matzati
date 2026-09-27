import { describe, expect, it } from "vitest";
import { absoluteUrl, DEFAULT_SITE_HOST, siteUrl } from "@/lib/config/site";

describe("siteUrl (SITE_URL)", () => {
  it("uses the Vercel production host", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "matzati-il.vercel.app" })).toBe(
      "https://matzati-il.vercel.app",
    );
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "www.matzati.co.il" })).toBe(
      "https://www.matzati.co.il",
    );
  });

  it("tolerates a scheme, a trailing slash, spaces and capitals", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: " https://Matzati.co.il/ " })).toBe(
      "https://matzati.co.il",
    );
  });

  it("falls back to the production host when unset or malformed", () => {
    const fallback = `https://${DEFAULT_SITE_HOST}`;
    expect(siteUrl({})).toBe(fallback);
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "" })).toBe(fallback);
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "evil.com/path?x" })).toBe(fallback);
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "localhost" })).toBe(fallback);
    expect(fallback).toBe("https://matzati-il.vercel.app");
  });

  it("builds absolute URLs", () => {
    const env = { VERCEL_PROJECT_PRODUCTION_URL: "matzati-il.vercel.app" };
    expect(absoluteUrl("/sitemap.xml", env)).toBe("https://matzati-il.vercel.app/sitemap.xml");
    expect(absoluteUrl("s/abc", env)).toBe("https://matzati-il.vercel.app/s/abc");
  });
});
