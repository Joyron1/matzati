// The home carousel's server HTML with 50 products: one labelled list, the pause button, the first
// two photos fetched first (the largest paint on phones) and every other photo lazy, and the warm-up
// of the other hot lists scheduled after the response. Queries are faked: no AliExpress, no cache.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HotProduct } from "@/lib/hot/select";

const state = vi.hoisted(() => ({ products: [] as unknown[], after: [] as (() => unknown)[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  connection: async () => {},
  after: (task: () => unknown) => state.after.push(task),
}));
const warm = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/hot/queries", () => ({
  hotCarouselProducts: async () => state.products,
  warmCarouselLists: warm,
}));

const product = (i: number): HotProduct => ({
  productId: `100500${i}`,
  title: `מוצר ${i}`,
  imageUrl: `https://ae-pic-a1.aliexpress-media.com/kf/S${i}.jpg`,
  price: 10 + i,
  originalPrice: null,
  discountPct: null,
  positiveFeedbackPct: 96,
  unitsSold: 1000 + i,
  hasVideo: false,
  promoCode: null,
  categoryId: "44",
  subcategoryId: `s${i % 9}`,
  shopId: null,
});

async function render(): Promise<string> {
  const { HotProductsCarousel } = await import("./hot-products-carousel");
  const element = await HotProductsCarousel();
  return element ? renderToStaticMarkup(element) : "";
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

beforeEach(() => {
  state.after.length = 0;
  warm.mockClear();
});

describe("HotProductsCarousel", () => {
  it("renders 50 cards, two photos eager at high priority and the rest lazy", async () => {
    state.products = Array.from({ length: 50 }, (_, i) => product(i));
    const html = await render();
    expect(count(html, /<ul id="[^"]+" aria-label="מוצרים חמים"/g)).toBe(1);
    expect(count(html, /href="\/p\/100500\d+"/g)).toBe(50);
    expect(count(html, /<img [^>]*loading="eager"/g)).toBe(2);
    expect(count(html, /<img [^>]*fetchPriority="high"/g)).toBe(2);
    expect(count(html, /<img [^>]*loading="lazy"/g)).toBe(48);
    expect(
      count(html, /sizes="\(min-width: 1024px\) 208px, \(min-width: 640px\) 192px, 40vw"/g),
    ).toBeGreaterThanOrEqual(50);
    // The eager photos are the first two cards'.
    const firstLazy = html.search(/<img [^>]*loading="lazy"/);
    expect(html.lastIndexOf('loading="eager"')).toBeLessThan(firstLazy);
    expect(html.indexOf("S1.jpg")).toBeLessThan(firstLazy);
    expect(html).toContain('aria-label="השהיית המעבר האוטומטי בין המוצרים"');
  });

  it("warms the other hot lists after the response, never before it", async () => {
    state.products = [product(1)];
    await render();
    expect(warm).not.toHaveBeenCalled();
    expect(state.after).toHaveLength(1);
    await state.after[0]();
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without products, and still schedules the warm-up", async () => {
    state.products = [];
    expect(await render()).toBe("");
    expect(state.after).toHaveLength(1);
  });
});
