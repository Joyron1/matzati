import { describe, expect, it } from "vitest";
import { absoluteUrl, LEGACY_SITE_HOST, SITE_HOST, siteUrl } from "@/lib/config/site";
import nextConfig from "@/next.config";

describe("siteUrl (SITE_URL)", () => {
  it("is the official domain, whatever Vercel reports", () => {
    expect(siteUrl()).toBe("https://www.matzati-il.com");
    expect(SITE_HOST).toBe("www.matzati-il.com");
  });

  it("builds absolute URLs", () => {
    expect(absoluteUrl("/sitemap.xml")).toBe("https://www.matzati-il.com/sitemap.xml");
    expect(absoluteUrl("s/abc")).toBe("https://www.matzati-il.com/s/abc");
  });
});

describe("the old vercel.app address", () => {
  it("redirects every page to the same path on the official domain, keeping /api", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const legacy = redirects.find((r) =>
      r.has?.some((h) => h.type === "host" && h.value === LEGACY_SITE_HOST),
    );
    expect(legacy).toMatchObject({
      destination: `https://${SITE_HOST}/:path`,
      permanent: true,
    });
    const source = new RegExp(`^${legacy!.source.replace("/:path(", "/(")}$`);
    expect(source.test("/")).toBe(true);
    expect(source.test("/p/1005001")).toBe(true);
    expect(source.test("/admin/auth/callback")).toBe(true);
    expect(source.test("/api/cron/seo-refresh")).toBe(false);
    expect(source.test("/api/search")).toBe(false);
  });
});
