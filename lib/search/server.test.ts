// productForPage wiring for /p (stored tips, background refresh with after(), video, AliExpress
// promo code, owner and community coupons, SKU flag) and clickOut for /go (link refresh, src).
// Database, AliExpress calls, coupons, deals and the refresher are faked; nothing here reaches
// Supabase, AliExpress or an LLM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import type {
  AliProduct,
  AliPromotionLink,
  AliSkuDetails,
  ProductPage,
} from "@/lib/aliexpress/schemas";
import type { Coupon } from "@/lib/coupons/types";
import { TIPS_VERSION } from "@/lib/llm/tips";
import type { TipsEntry } from "@/lib/tips/store";
import { TipsStoreError } from "@/lib/tips/store";
import type { Deal } from "@/lib/types";
import { clickOut, productForPage } from "./server";

interface DbUpdate {
  table: string;
  values: Record<string, unknown>;
  filters: [string, unknown][];
}

const m = vi.hoisted(() => {
  const state = { skuEnabled: false, updateError: null as { message: string } | null };
  const updates: DbUpdate[] = [];
  // Just enough of the Supabase query builder for saveLink: from().update().eq().eq(), awaited.
  const db = {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const entry: DbUpdate = { table, values, filters: [] };
        updates.push(entry);
        const chain = {
          eq(column: string, value: unknown) {
            entry.filters.push([column, value]);
            return chain;
          },
          then<T>(resolve: (r: { error: { message: string } | null }) => T) {
            return Promise.resolve({ error: state.updateError }).then(resolve);
          },
        };
        return chain;
      },
    }),
  };
  return {
    state,
    updates,
    db,
    after: vi.fn<(job: () => unknown) => void>(),
    getProduct: vi.fn(),
    saveProducts:
      vi.fn<(products: AliProduct[], titles: Record<string, string | null>) => Promise<void>>(),
    logClick: vi.fn<(productId: string, src: string) => Promise<void>>(),
    couponForProduct: vi.fn<(productId: string, now: Date) => Promise<Deal | null>>(),
    couponsForProduct: vi.fn<(productId: string, now: Date) => Promise<Coupon[]>>(),
    readCategoryTips: vi.fn<(categoryId: string, now: Date) => Promise<TipsEntry | null>>(),
    refresh: vi.fn(async () => {}),
    getProductDetails: vi.fn<(client: unknown, ids: string[]) => Promise<ProductPage>>(),
    generateLinks: vi.fn<(client: unknown, urls: string[]) => Promise<AliPromotionLink[]>>(),
    getSkuDetails: vi.fn<(client: unknown, id: string) => Promise<AliSkuDetails | null>>(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => m.db }));
vi.mock("./supabase-store", () => ({
  SupabaseStore: class {
    getProduct = m.getProduct;
    saveProducts = m.saveProducts;
    logClick = m.logClick;
  },
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  aliexpressConfig: () => ({
    appKey: "k",
    appSecret: "s",
    trackingId: "trk",
    gateway: "https://g.test/sync",
  }),
}));
vi.mock("@/lib/aliexpress/affiliate", () => ({
  getProductDetails: m.getProductDetails,
  generateLinks: m.generateLinks,
  getSkuDetails: m.getSkuDetails,
}));
vi.mock("@/lib/config/site", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/site")>()),
  get SKU_DETAILS_ENABLED() {
    return m.state.skuEnabled;
  },
}));
vi.mock("@/lib/coupons/queries", () => ({ couponsForProduct: m.couponsForProduct }));
vi.mock("@/lib/deals/queries", () => ({ couponForProduct: m.couponForProduct }));
vi.mock("@/lib/tips/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tips/store")>()),
  readCategoryTips: m.readCategoryTips,
}));
vi.mock("@/lib/tips/refresh", () => ({
  TipsRefresher: class {
    refresh = m.refresh;
  },
}));

const ID = "1005001234567890";
const PRODUCT: AliProduct = {
  productId: ID,
  title: "TWS Bluetooth Earphones",
  price: 45.9,
  originalPrice: null,
  currency: "ILS",
  discountPct: null,
  positiveFeedbackPct: 97.5,
  unitsSold: 1200,
  mainImageUrl: "https://ae01.alicdn.com/a.jpg",
  imageUrls: ["https://ae01.alicdn.com/a.jpg"],
  detailUrl: `https://www.aliexpress.com/item/${ID}.html`,
  promotionLink: "https://s.click.aliexpress.com/e/_abc",
  shop: { id: "1", name: "Shop", url: null },
  commissionRatePct: 7,
  category: {
    firstId: "44",
    firstName: "Consumer Electronics",
    secondId: "100000306",
    secondName: "Portable Audio & Video",
  },
};
const TIPS = [
  "בדקו שהחיבור לטעינה הוא USB-C, כדי שתוכלו להשתמש באותו כבל של הטלפון.",
  "חפשו עמידות למים לפי תקן מוגדר כמו IPX7, ולא רק את המילה עמיד.",
];
const CATEGORY = {
  id: "100000306",
  nameEn: "Portable Audio & Video",
  parentEn: "Consumer Electronics",
};

function entry(stale: boolean): TipsEntry {
  return {
    categoryId: CATEGORY.id,
    categoryEn: CATEGORY.nameEn,
    tips: TIPS,
    version: TIPS_VERSION,
    updatedAt: new Date().toISOString(),
    stale,
  };
}

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "6f1c1c1e-2a55-4a55-9a55-0a55a55a55a5",
    type: "deal",
    title: "קופון לאוזניות",
    body: "",
    product_id: ID,
    coupon_code: "SAVE5",
    starts_at: null,
    ends_at: null,
    published: true,
    created_at: new Date().toISOString(),
    ...over,
  };
}

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

function stored(product: AliProduct = PRODUCT, updatedAt = new Date().toISOString()) {
  return { product, titleHe: "אוזניות אלחוטיות", updatedAt };
}

/**
 * Runs `work` on fake timers, so the pause between two AliExpress calls of one request passes at
 * once (Date moves with the timers).
 */
async function withFakeTimers<T>(work: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = work();
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.getProduct.mockResolvedValue(stored());
  m.saveProducts.mockResolvedValue(undefined);
  m.logClick.mockResolvedValue(undefined);
  m.couponForProduct.mockResolvedValue(null);
  m.couponsForProduct.mockResolvedValue([]);
  m.state.skuEnabled = false;
  m.state.updateError = null;
  m.updates.length = 0;
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("productForPage: category tips", () => {
  it("shows a fresh entry without scheduling any work", async () => {
    m.readCategoryTips.mockResolvedValue(entry(false));
    const data = await productForPage(ID);
    expect(m.readCategoryTips).toHaveBeenCalledWith(CATEGORY.id, expect.any(Date));
    expect(data).toMatchObject({ tips: TIPS, tipsCategoryHe: "מוצרי שמע ווידאו ניידים" });
    expect(m.after).not.toHaveBeenCalled();
  });

  it("schedules one background refresh with after() when the entry is missing", async () => {
    m.readCategoryTips.mockResolvedValue(null);
    const data = await productForPage(ID);
    expect(data?.tips).toBeNull();
    expect(data?.product.product_id).toBe(ID);
    expect(m.after).toHaveBeenCalledTimes(1);
    expect(m.refresh).not.toHaveBeenCalled(); // the page does not wait for the LLM

    await m.after.mock.calls[0][0]();
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(m.refresh).toHaveBeenCalledWith(CATEGORY, expect.any(Function));
  });

  it("keeps showing a stale entry while it is refreshed in the background", async () => {
    m.readCategoryTips.mockResolvedValue(entry(true));
    const data = await productForPage(ID);
    expect(data?.tips).toEqual(TIPS);
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it("runs the refresh detached when after() is unavailable (outside a request)", async () => {
    m.readCategoryTips.mockResolvedValue(null);
    m.after.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    await productForPage(ID);
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not generate tips when the store cannot be read, and still shows the page", async () => {
    m.readCategoryTips.mockRejectedValue(new TipsStoreError("read failed: timeout"));
    const data = await productForPage(ID);
    expect(data).toMatchObject({ tips: null, coupon: null });
    expect(data?.product.product_id).toBe(ID);
    expect(m.after).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("skips products whose category gets no tips", async () => {
    m.getProduct.mockResolvedValue({
      product: { ...PRODUCT, category: { ...PRODUCT.category, secondId: null, firstId: null } },
      titleHe: null,
      updatedAt: new Date().toISOString(),
    });
    const data = await productForPage(ID);
    expect(data).toMatchObject({ tips: null, tipsCategoryHe: null });
    expect(m.readCategoryTips).not.toHaveBeenCalled();
    expect(m.after).not.toHaveBeenCalled();
  });
});

describe("productForPage: community coupon", () => {
  beforeEach(() => {
    m.readCategoryTips.mockResolvedValue(entry(false));
  });

  it("passes a published coupon through", async () => {
    const coupon = deal();
    m.couponForProduct.mockResolvedValue(coupon);
    expect((await productForPage(ID))?.coupon).toEqual(coupon);
    expect(m.couponForProduct).toHaveBeenCalledWith(ID, expect.any(Date));
  });

  it("shows the page without a coupon when the deals query fails", async () => {
    m.couponForProduct.mockRejectedValue(new Error("not implemented"));
    const data = await productForPage(ID);
    expect(data?.coupon).toBeNull();
    expect(data?.tips).toEqual(TIPS);
  });

  it("never offers a coupon from a 'dont_buy' warning or without a code", async () => {
    m.couponForProduct.mockResolvedValue(deal({ type: "dont_buy" }));
    expect((await productForPage(ID))?.coupon).toBeNull();
    m.couponForProduct.mockResolvedValue(deal({ coupon_code: "  " }));
    expect((await productForPage(ID))?.coupon).toBeNull();
  });
});

function promoCode(over: Partial<AliPromoCode> = {}): AliPromoCode {
  return {
    code: "AJO7RM0ITRX2",
    offerText: "On order over ILS 62.2 , get ILS 3.11 off",
    offer: { kind: "amount", off: 3.11, minSpend: 62.2, currency: "ILS" },
    minSpend: 62.2,
    startsAt: daysAgo(10),
    endsAt: daysAgo(-10),
    promotionUrl: null,
    ...over,
  };
}

function ownerCoupon(over: Partial<Coupon> = {}): Coupon {
  return {
    id: "0b7c7f0e-1111-4111-8111-111111111111",
    code: "MATZATI5",
    title: "₪5 הנחה בהזמנה מעל ₪40",
    terms: null,
    min_spend_ils: 40,
    scope: "product",
    product_id: ID,
    sale_id: null,
    starts_at: null,
    ends_at: null,
    featured: false,
    published: true,
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    ...over,
  };
}

describe("productForPage: video and AliExpress promo code", () => {
  beforeEach(() => {
    m.readCategoryTips.mockResolvedValue(entry(false));
  });

  it("reads a product saved before videos and promo codes as having neither", async () => {
    const data = await productForPage(ID);
    expect(data).toMatchObject({ videoUrl: null, apiCoupon: null, skuDetails: null });
  });

  it("passes the video through", async () => {
    const videoUrl = "https://video.aliexpress-media.com/play/u/ae_sg_item/1/p/1/e/6/t/10301/2.mp4";
    m.getProduct.mockResolvedValue(stored({ ...PRODUCT, videoUrl }));
    expect((await productForPage(ID))?.videoUrl).toBe(videoUrl);
  });

  it("shows the promo code only while it is valid, and only for ILS prices", async () => {
    const withCode = (code: AliPromoCode, currency = "ILS") =>
      m.getProduct.mockResolvedValue(stored({ ...PRODUCT, currency, promoCode: code }));

    const valid = promoCode();
    withCode(valid);
    expect((await productForPage(ID))?.apiCoupon).toEqual(valid);
    withCode(promoCode({ endsAt: daysAgo(1) }));
    expect((await productForPage(ID))?.apiCoupon).toBeNull();
    withCode(promoCode({ startsAt: daysAgo(-1) }));
    expect((await productForPage(ID))?.apiCoupon).toBeNull();
    withCode(promoCode({ endsAt: null }));
    expect((await productForPage(ID))?.apiCoupon).toBeNull();
    withCode(promoCode(), "USD");
    expect((await productForPage(ID))?.apiCoupon).toBeNull();
  });

  it("reads the stored video and promo code through the same checks as a fresh response", async () => {
    m.getProduct.mockResolvedValue(
      stored({
        ...PRODUCT,
        videoUrl: "https://evil.test/v.mp4",
        promoCode: { ...promoCode(), code: "<b>SAVE</b>" },
      }),
    );
    expect(await productForPage(ID)).toMatchObject({ videoUrl: null, apiCoupon: null });
  });
});

describe("productForPage: owner coupons", () => {
  beforeEach(() => {
    m.readCategoryTips.mockResolvedValue(entry(false));
  });

  it("shows owner coupons and then drops the community coupon", async () => {
    const coupon = ownerCoupon();
    m.couponsForProduct.mockResolvedValue([coupon]);
    m.couponForProduct.mockResolvedValue(deal());
    const data = await productForPage(ID);
    expect(m.couponsForProduct).toHaveBeenCalledWith(ID, expect.any(Date));
    expect(data).toMatchObject({ ownerCoupons: [coupon], coupon: null });
  });

  it("keeps the community coupon as the fallback, also when the coupons read fails", async () => {
    const community = deal();
    m.couponForProduct.mockResolvedValue(community);
    expect(await productForPage(ID)).toMatchObject({ ownerCoupons: [], coupon: community });
    m.couponsForProduct.mockRejectedValue(new Error("timeout"));
    expect(await productForPage(ID)).toMatchObject({ ownerCoupons: [], coupon: community });
  });
});

describe("productForPage: refresh after 24 hours", () => {
  const FRESH_LINK = "https://s.click.aliexpress.com/s/fresh";

  beforeEach(() => {
    m.readCategoryTips.mockResolvedValue(entry(false));
    m.getProduct.mockResolvedValue(stored(PRODUCT, daysAgo(2)));
  });

  const detailsReturn = (product: AliProduct) =>
    m.getProductDetails.mockResolvedValue({ products: [product], skipped: 0, totalRecords: 1 });

  it("saves and shows the fresh video and promo code, and never loads SKUs while the flag is off", async () => {
    const videoUrl = "https://video.aliexpress-media.com/play/u/3.mp4";
    const code = promoCode();
    detailsReturn({ ...PRODUCT, promotionLink: FRESH_LINK, videoUrl, promoCode: code });
    const data = await productForPage(ID);
    expect(m.getProductDetails).toHaveBeenCalledTimes(1);
    expect(m.saveProducts).toHaveBeenCalledTimes(1);
    expect(data).toMatchObject({ videoUrl, apiCoupon: code, skuDetails: null });
    expect(m.getSkuDetails).not.toHaveBeenCalled();
  });

  it("loads SKU details with the refresh once the flag is on, 1.1 s after productdetail", async () => {
    m.state.skuEnabled = true;
    const details: AliSkuDetails = { reviewCount: null, score: null, skus: [] };
    const at: number[] = [];
    m.getProductDetails.mockImplementation(async () => {
      at.push(Date.now());
      return { products: [{ ...PRODUCT, promotionLink: FRESH_LINK }], skipped: 0, totalRecords: 1 };
    });
    m.getSkuDetails.mockImplementation(async () => {
      at.push(Date.now());
      return details;
    });
    expect((await withFakeTimers(() => productForPage(ID)))?.skuDetails).toEqual(details);
    expect(m.getSkuDetails).toHaveBeenCalledWith(expect.anything(), ID);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(1_100);

    // A failed SKU call only leaves them out.
    m.getSkuDetails.mockRejectedValue(new Error("InsufficientPermission"));
    const data = await withFakeTimers(() => productForPage(ID));
    expect(data?.skuDetails).toBeNull();
    expect(data?.product.product_id).toBe(ID);
  });

  it("keeps a fresh stored link, with its age, when productdetail sends none", async () => {
    const row = stored(PRODUCT, daysAgo(2));
    m.getProduct.mockResolvedValue(row);
    detailsReturn({ ...PRODUCT, promotionLink: null });
    await productForPage(ID);
    expect(m.generateLinks).not.toHaveBeenCalled();
    expect(m.saveProducts.mock.calls[0][0][0]).toMatchObject({
      promotionLink: PRODUCT.promotionLink,
      promotionLinkAt: row.updatedAt,
    });
  });

  it("makes a new link instead of keeping one older than LINK_MAX_AGE_DAYS, 1.1 s later", async () => {
    m.getProduct.mockResolvedValue(stored(PRODUCT, daysAgo(91)));
    const at: number[] = [];
    m.getProductDetails.mockImplementation(async () => {
      at.push(Date.now());
      return { products: [{ ...PRODUCT, promotionLink: null }], skipped: 0, totalRecords: 1 };
    });
    m.generateLinks.mockImplementation(async () => {
      at.push(Date.now());
      return [
        { sourceValue: "x", promotionLink: "https://s.click.aliexpress.com/e/_new", message: null },
      ];
    });
    await withFakeTimers(() => productForPage(ID));
    expect(m.generateLinks).toHaveBeenCalledTimes(1);
    // The app key's frequency ban lasts about a second: never two calls back to back.
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(1_100);
    expect(m.saveProducts.mock.calls[0][0][0].promotionLink).toBe(
      "https://s.click.aliexpress.com/e/_new",
    );
  });
});

describe("clickOut", () => {
  const NEW_LINK = "https://s.click.aliexpress.com/e/_regenerated";
  const linkResult = (promotionLink: string | null, id = ID): AliPromotionLink[] => [
    { sourceValue: `https://www.aliexpress.com/item/${id}.html`, promotionLink, message: null },
  ];

  // /go remembers each product's link.generate result for 10 minutes (per server instance), so
  // every test that regenerates a link uses a product id no other test used.
  let nextId = 1005009000000000;
  /** Stores a product with a link made `updatedAt` (120 days ago by default); returns its id. */
  function staleProduct(over: Partial<AliProduct> = {}, updatedAt = daysAgo(120)) {
    const productId = String(nextId++);
    m.getProduct.mockResolvedValue(stored({ ...PRODUCT, productId, ...over }, updatedAt));
    return productId;
  }

  it("redirects to a fresh stored link without calling AliExpress, and logs the src", async () => {
    await expect(clickOut(ID, "reviews")).resolves.toBe(PRODUCT.promotionLink);
    expect(m.logClick).toHaveBeenCalledWith(ID, "reviews");
    expect(m.generateLinks).not.toHaveBeenCalled();
    expect(m.updates).toHaveLength(0);
  });

  it("logs a src it does not accept as 'other'", async () => {
    await clickOut(ID, "not a src!");
    expect(m.logClick).toHaveBeenCalledWith(ID, "other");
  });

  it("regenerates a link older than LINK_MAX_AGE_DAYS once and saves only the link", async () => {
    const updatedAt = daysAgo(91);
    const id = staleProduct({}, updatedAt);
    m.generateLinks.mockResolvedValue(linkResult(NEW_LINK, id));

    await expect(clickOut(id, "product")).resolves.toBe(NEW_LINK);
    expect(m.generateLinks).toHaveBeenCalledTimes(1);
    expect(m.generateLinks).toHaveBeenCalledWith(expect.anything(), [
      `https://www.aliexpress.com/item/${id}.html`,
    ]);
    // updated_at stays as it was: the price is no fresher than before.
    expect(m.saveProducts).not.toHaveBeenCalled();
    expect(m.updates).toHaveLength(1);
    const [{ table, values, filters }] = m.updates;
    expect(table).toBe("products");
    expect(Object.keys(values)).toEqual(["data"]);
    expect(values.data).toMatchObject({ ...PRODUCT, productId: id, promotionLink: NEW_LINK });
    expect(Date.parse((values.data as AliProduct).promotionLinkAt ?? "")).toBeGreaterThan(
      Date.now() - 60_000,
    );
    expect(filters).toEqual([
      ["product_id", id],
      ["updated_at", updatedAt],
    ]);
  });

  it("counts the link's age from promotionLinkAt when /go made it after the row was saved", async () => {
    m.getProduct.mockResolvedValue(
      stored({ ...PRODUCT, promotionLinkAt: daysAgo(10) }, daysAgo(200)),
    );
    await expect(clickOut(ID, "product")).resolves.toBe(PRODUCT.promotionLink);
    expect(m.generateLinks).not.toHaveBeenCalled();
  });

  it("falls back to the stored link when link.generate fails or gives nothing usable", async () => {
    const failing = staleProduct();
    m.generateLinks.mockRejectedValueOnce(new Error("ApiCallLimit"));
    await expect(clickOut(failing, "product")).resolves.toBe(PRODUCT.promotionLink);
    for (const bad of [null, "https://evil.test/redirect"]) {
      const id = staleProduct();
      m.generateLinks.mockResolvedValueOnce(linkResult(bad, id));
      await expect(clickOut(id, "product")).resolves.toBe(PRODUCT.promotionLink);
    }
    expect(m.generateLinks).toHaveBeenCalledTimes(3);
    expect(m.updates).toHaveLength(0);
  });

  it("still redirects to the new link when saving it fails", async () => {
    const id = staleProduct();
    m.generateLinks.mockResolvedValue(linkResult(NEW_LINK, id));
    m.state.updateError = { message: "timeout" };
    await expect(clickOut(id, "product")).resolves.toBe(NEW_LINK);
  });

  it("makes a link for a product without one, and 404s when there is none", async () => {
    const id = staleProduct({ promotionLink: null }, new Date().toISOString());
    m.generateLinks.mockResolvedValueOnce(linkResult(NEW_LINK, id));
    await expect(clickOut(id, "product")).resolves.toBe(NEW_LINK);
    const none = staleProduct({ promotionLink: null }, new Date().toISOString());
    m.generateLinks.mockResolvedValueOnce(linkResult(null, none));
    await expect(clickOut(none, "product")).resolves.toBeNull();
  });

  it("lets clicks that arrive together share one link.generate call", async () => {
    const id = staleProduct();
    let finish: (links: AliPromotionLink[]) => void = () => {};
    m.generateLinks.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const clicks = [clickOut(id, "product"), clickOut(id, "reviews"), clickOut(id, "product")];
    // Let every click read the row and reach the link step before AliExpress answers.
    await vi.waitFor(() => expect(m.logClick).toHaveBeenCalledTimes(3));
    finish(linkResult(NEW_LINK, id));
    await expect(Promise.all(clicks)).resolves.toEqual([NEW_LINK, NEW_LINK, NEW_LINK]);
    expect(m.generateLinks).toHaveBeenCalledTimes(1);
    expect(m.updates).toHaveLength(1);
  });

  it("does not call again for 10 minutes after a failure, then tries once more", async () => {
    const id = staleProduct();
    m.generateLinks.mockRejectedValue(new Error("ApiCallLimit"));
    await expect(clickOut(id, "product")).resolves.toBe(PRODUCT.promotionLink);
    await expect(clickOut(id, "product")).resolves.toBe(PRODUCT.promotionLink);
    expect(m.generateLinks).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ now: Date.now() + 10 * 60_000 });
    try {
      m.generateLinks.mockResolvedValue(linkResult(NEW_LINK, id));
      await expect(clickOut(id, "product")).resolves.toBe(NEW_LINK);
      expect(m.generateLinks).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses a new link it could not save instead of calling again", async () => {
    const id = staleProduct();
    m.generateLinks.mockResolvedValue(linkResult(NEW_LINK, id));
    m.state.updateError = { message: "timeout" };
    await expect(clickOut(id, "product")).resolves.toBe(NEW_LINK);
    await expect(clickOut(id, "reviews")).resolves.toBe(NEW_LINK);
    expect(m.generateLinks).toHaveBeenCalledTimes(1);
  });
});
