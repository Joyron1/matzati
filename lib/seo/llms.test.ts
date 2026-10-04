import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG, categoryPath } from "@/lib/catalog/categories";
import { LEGAL } from "@/lib/config/legal";
import { FILTERS } from "@/lib/ranking/config";
import { buildLlmsTxt, LLMS_EXAMPLE_QUERIES, searchUrl } from "./llms";

const m = vi.hoisted(() => ({
  pages: vi.fn(),
  coupons: vi.fn(async () => true),
  deals: vi.fn(async () => false),
  sales: vi.fn(async () => true),
}));
vi.mock("@/lib/seo/queries", () => ({ listPublishedSeoPages: m.pages }));
vi.mock("@/lib/coupons/queries", () => ({ hasPublishedCoupons: m.coupons }));
vi.mock("@/lib/deals/queries", () => ({
  hasPublishedDeals: m.deals,
  hasUpcomingSales: m.sales,
}));

const PAGES = [
  {
    slug: "earbuds-for-running",
    title_he: "אוזניות לריצה [מומלצות]",
    query: "אוזניות לריצה",
    intro_he: null,
    published: true,
    created_at: "2026-09-29T00:00:00Z",
    updated_at: "2026-09-29T00:00:00Z",
  },
];

const ORIGIN = "https://www.matzati-il.com";
const urlsIn = (text: string) => text.match(/https?:\/\/[^\s)]+/g) ?? [];

describe("buildLlmsTxt", () => {
  const text = buildLlmsTxt({ pages: PAGES, hasCoupons: true, hasSales: false, hasDeals: false });

  it("follows the llms.txt shape: a title, a summary in Hebrew and English, link sections", () => {
    expect(text.startsWith("# מצאתי (Matzati)\n\n> ")).toBe(true);
    for (const heading of [
      "## Main pages",
      "## Product lists for popular searches",
      "## Sending someone to a search",
      "## Policies",
    ]) {
      expect(text).toContain(`\n${heading}\n`);
    }
    expect(text).toMatch(/Hebrew AI shopping assistant for AliExpress/);
    expect(text).toMatch(/not affiliated with or endorsed by AliExpress/);
    expect(text).toContain(`${ORIGIN}/terms#affiliate`);
  });

  it("states the thresholds the code filters with", () => {
    const pct = `${FILTERS.minPositiveFeedbackPct}%`;
    expect(text).toContain(`לפחות ${pct} משוב חיובי`);
    expect(text).toContain(`at least ${pct} positive buyer feedback`);
    expect(text).toContain(`at least ${FILTERS.minUnitsSold} sales in the last 30 days`);
    expect(text).toContain("first those that passed our filters");
  });

  it("links only absolute addresses on the official host", () => {
    const urls = urlsIn(text);
    expect(urls.length).toBeGreaterThan(10);
    for (const url of urls) expect(url.startsWith(`${ORIGIN}/`) || url === ORIGIN).toBe(true);
    expect(text).toContain(`[אוזניות לריצה מומלצות](${ORIGIN}/s/earbuds-for-running)`);
    expect(text).toContain(`[All products (כל המוצרים)](${ORIGIN}/products)`);
    // Every category page, percent-encoded like the sitemap.
    for (const c of CATALOG) {
      expect(text).toContain(`[כל המוצרים: ${c.nameHe}](${ORIGIN}${categoryPath(c)})`);
    }
    expect(text).toContain(`(${ORIGIN}/products/${encodeURIComponent("תכשיטים")})`);
    expect(text).not.toContain("/hot");
    expect(text).toContain(`(${ORIGIN}/coupons)`);
    expect(text).not.toContain("/sales)");
  });

  it("shows how to open a search, with encoded examples", () => {
    for (const q of LLMS_EXAMPLE_QUERIES) {
      expect(text).toContain(`[${q}](${searchUrl(q)})`);
      expect(searchUrl(q)).toBe(`${ORIGIN}/search?q=${encodeURIComponent(q)}`);
    }
  });

  it("leaves the landing pages out when they could not be read", () => {
    const without = buildLlmsTxt({
      pages: null,
      hasCoupons: false,
      hasSales: true,
      hasDeals: true,
    });
    expect(without).not.toContain("## Product lists for popular searches");
    expect(without).toContain(`(${ORIGIN}/sales)`);
    expect(without).toContain(`(${ORIGIN}/deals)`);
    expect(without).not.toContain("/coupons)");
  });

  it("names the contact email only when it is set", () => {
    if (LEGAL.contactEmail) expect(text).toContain(`- Email: ${LEGAL.contactEmail}`);
    else expect(text).not.toContain("## Contact");
  });
});

describe("GET /llms.txt", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "fake-anthropic-secret-123456";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-654321";
    process.env.ALIEXPRESS_APP_SECRET = "ali-secret-abcdef";
    m.pages.mockReset();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("answers 200 with Markdown text, the landing pages and no secret", async () => {
    m.pages.mockResolvedValue(PAGES);
    const { GET } = await import("@/app/llms.txt/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("## Product lists for popular searches");
    for (const secret of ["fake-anthropic-secret", "service-role-secret", "ali-secret"]) {
      expect(body).not.toContain(secret);
    }
    for (const url of urlsIn(body)) expect(url.startsWith(ORIGIN)).toBe(true);
  });

  it("still answers when the landing pages cannot be read", async () => {
    m.pages.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/llms.txt/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("## Product lists for popular searches");
    spy.mockRestore();
  });
});
