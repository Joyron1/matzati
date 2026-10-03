// The routes around "כל המוצרים": the /hot redirect and the sitemap entries (app/hot/route.ts,
// app/sitemap.ts). The database reads of the sitemap are fakes.
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { CATALOG, categoryPath } from "./categories";

vi.mock("@/lib/seo/queries", () => ({ listPublishedSeoPages: vi.fn(async () => []) }));
vi.mock("@/lib/coupons/queries", () => ({ hasPublishedCoupons: vi.fn(async () => false) }));
vi.mock("@/lib/deals/queries", () => ({
  hasPublishedDeals: vi.fn(async () => false),
  hasUpcomingSales: vi.fn(async () => false),
}));

const ORIGIN = "https://www.matzati-il.com";

async function redirect(path: string) {
  const { GET } = await import("@/app/hot/route");
  return GET(new NextRequest(`${ORIGIN}${path}`));
}

describe("/hot (permanent redirect to /products)", () => {
  it("sends /hot to /products, keeping the filters", async () => {
    const res = await redirect("/hot");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/products`);
    const filtered = await redirect("/hot?price=50-100&sort=discount&video=1&page=2");
    expect(filtered.headers.get("location")).toBe(
      `${ORIGIN}/products?price=50-100&sort=discount&video=1&page=2`,
    );
  });

  it("sends /hot?cat=<id> to that category's page", async () => {
    const res = await redirect("/hot?cat=26&code=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/products/${encodeURIComponent("צעצועים")}?code=1`,
    );
  });

  it("drops an unknown category, as /hot ignored it", async () => {
    const res = await redirect("/hot?cat=999");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/products`);
  });
});

describe("the sitemap", () => {
  it("lists /products and every category page, right after the home page", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls[1]).toBe(`${ORIGIN}/products`);
    for (const c of CATALOG) expect(urls).toContain(`${ORIGIN}${categoryPath(c)}`);
    expect(urls.some((u) => u.includes("/hot"))).toBe(false);
  });
});
