import { describe, expect, it, vi } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { ensureDealProduct, type ProductImportDeps } from "./import-product";

const ID = "1005006123456789";

function product(over: Partial<AliProduct> = {}): AliProduct {
  return {
    productId: ID,
    title: "USB C cable 100W",
    price: 12.5,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 97.1,
    unitsSold: 1200,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: ["https://ae-pic-a1.aliexpress-media.com/kf/a.jpg"],
    detailUrl: `https://www.aliexpress.com/item/${ID}.html`,
    promotionLink: "https://s.click.aliexpress.com/e/_abc",
    shop: { id: "1", name: "Shop", url: null },
    commissionRatePct: 7,
    category: { firstId: null, firstName: null, secondId: null, secondName: null },
    ...over,
  };
}

/** In-memory products table plus fake AliExpress calls, all spied. */
function deps(
  opts: {
    stored?: boolean;
    details?: AliProduct | null;
    link?: string | null;
    saveFails?: boolean;
  } = {},
) {
  const table = new Map<string, AliProduct>();
  if (opts.stored) table.set(ID, product());
  const d = {
    isStored: vi.fn(async (id: string) => table.has(id)),
    fetchDetails: vi.fn(async () => (opts.details === undefined ? product() : opts.details)),
    generateLink: vi.fn(async () => opts.link ?? null),
    save: vi.fn(async (p: AliProduct) => {
      if (!opts.saveFails) table.set(p.productId, p);
    }),
  } satisfies ProductImportDeps;
  return { d, table };
}

describe("ensureDealProduct", () => {
  it("does nothing for a product we already have (no AliExpress calls)", async () => {
    const { d } = deps({ stored: true });
    expect(await ensureDealProduct(ID, d)).toEqual({ ok: true, imported: false });
    expect(d.fetchDetails).not.toHaveBeenCalled();
    expect(d.generateLink).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  it("fetches and saves a new product that comes with a promotion link", async () => {
    const { d, table } = deps();
    expect(await ensureDealProduct(ID, d)).toEqual({ ok: true, imported: true });
    expect(d.fetchDetails).toHaveBeenCalledTimes(1);
    expect(d.generateLink).not.toHaveBeenCalled();
    expect(table.get(ID)?.promotionLink).toBe("https://s.click.aliexpress.com/e/_abc");
  });

  it("generates an affiliate link when the details have none", async () => {
    const { d, table } = deps({
      details: product({ promotionLink: null }),
      link: "https://s.click.aliexpress.com/e/_gen",
    });
    expect(await ensureDealProduct(ID, d)).toEqual({ ok: true, imported: true });
    expect(d.generateLink).toHaveBeenCalledWith(ID);
    expect(table.get(ID)?.promotionLink).toBe("https://s.click.aliexpress.com/e/_gen");
  });

  it("reports an id AliExpress does not know", async () => {
    const { d } = deps({ details: null });
    expect(await ensureDealProduct(ID, d)).toEqual({ ok: false, error: "not_found" });
    expect(d.save).not.toHaveBeenCalled();
    const other = deps({ details: product({ productId: "42" }) });
    expect(await ensureDealProduct(ID, other.d)).toEqual({ ok: false, error: "not_found" });
  });

  it("never saves a product we cannot link", async () => {
    const { d } = deps({ details: product({ promotionLink: null }), link: null });
    expect(await ensureDealProduct(ID, d)).toEqual({ ok: false, error: "no_link" });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("notices a save that silently failed", async () => {
    const { d } = deps({ saveFails: true });
    expect(await ensureDealProduct(ID, d)).toEqual({ ok: false, error: "not_saved" });
  });

  it("lets AliExpress failures reach the caller", async () => {
    const { d } = deps();
    d.fetchDetails.mockRejectedValueOnce(new Error("AliExpress HTTP 503"));
    await expect(ensureDealProduct(ID, d)).rejects.toThrow("503");
  });
});
