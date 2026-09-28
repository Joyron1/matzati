// productForPage wiring for /p (stored tips, background refresh with after(), video, AliExpress
// promo code, owner and community coupons, SKU flag, the refresh guard after a failure or a rate
// limit) and clickOut for /go (link refresh, src).
// Database, AliExpress calls, coupons, deals and the refresher are faked; nothing here reaches
// Supabase, AliExpress or an LLM.
import { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AliExpressError } from "@/lib/aliexpress/errors";
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
import { SearchError } from "./pipeline";
import { clickOut, clickRefFrom, failureCode, productForPage } from "./server";

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
    logClick:
      vi.fn<(productId: string, src: string, ref?: unknown, owner?: boolean) => Promise<void>>(),
    getAdminUser: vi.fn<() => Promise<{ email: string } | null>>(async () => null),
    couponForProduct: vi.fn<(productId: string, now: Date) => Promise<Deal | null>>(),
    couponsForProduct: vi.fn<(productId: string, now: Date) => Promise<Coupon[]>>(),
    readCategoryTips: vi.fn<(categoryId: string, now: Date) => Promise<TipsEntry | null>>(),
    refresh: vi.fn(async () => {}),
    getProductDetails:
      vi.fn<(client: unknown, ids: string[], language?: "EN" | "HE") => Promise<ProductPage>>(),
    generateLinks:
      vi.fn<
        (
          client: unknown,
          urls: string[],
          options?: { promotionLinkType?: 0 | 2 },
        ) => Promise<AliPromotionLink[]>
      >(),
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
vi.mock("@/lib/aliexpress/affiliate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aliexpress/affiliate")>()),
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
// The admin session (search_log.owner, clicks.owner): a visitor unless a test signs in.
vi.mock("@/lib/admin/auth", () => ({ getAdminUser: m.getAdminUser }));
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
  m.getAdminUser.mockResolvedValue(null);
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
    // A product a search saved (English title) is refreshed in English.
    expect(m.getProductDetails).toHaveBeenCalledWith(expect.anything(), [ID], "EN");
    expect(m.saveProducts).toHaveBeenCalledTimes(1);
    expect(m.saveProducts.mock.calls[0][0][0].promotionLink).toBe(FRESH_LINK);
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

  describe("a product saved from a hot list", () => {
    const HOT_TITLE = "אוזניות אלחוטיות TWS 5.3 עם מיקרופון";
    const HOT_LINK = "https://s.click.aliexpress.com/s/hot-list";
    const hotRow = (product: Partial<AliProduct>, updatedAt = daysAgo(2)) => ({
      product: { ...PRODUCT, title: HOT_TITLE, promotionLink: HOT_LINK, ...product },
      titleHe: null,
      updatedAt,
    });

    it("is refreshed in Hebrew and keeps the list's link, marked as from the list", async () => {
      const row = hotRow({ source: "hot", hotCommissionRatePct: 8 });
      m.getProduct.mockResolvedValue(row);
      detailsReturn({
        ...PRODUCT,
        title: `${HOT_TITLE} חדש`,
        promotionLink: FRESH_LINK,
        hotCommissionRatePct: null, // productdetail.get sends "0.0%"
      });
      const data = await productForPage(ID);
      expect(m.getProductDetails).toHaveBeenCalledWith(expect.anything(), [ID], "HE");
      const [[saved], titles] = m.saveProducts.mock.calls[0];
      expect(saved).toMatchObject({
        title: `${HOT_TITLE} חדש`,
        promotionLink: HOT_LINK,
        promotionLinkAt: row.updatedAt,
        source: "hot",
        hotCommissionRatePct: 8, // the list's, kept for stats
      });
      expect(titles).toEqual({ [ID]: null });
      // The page shows AliExpress's Hebrew title as it is (lib/product-title.ts).
      expect(data?.product).toMatchObject({
        title_he: `${HOT_TITLE} חדש`,
        title_en: `${HOT_TITLE} חדש`,
      });
    });

    it("is known by its Hebrew title when it was saved before rows were marked", async () => {
      m.getProduct.mockResolvedValue(hotRow({}));
      detailsReturn({ ...PRODUCT, title: HOT_TITLE, promotionLink: FRESH_LINK });
      await productForPage(ID);
      expect(m.getProductDetails).toHaveBeenCalledWith(expect.anything(), [ID], "HE");
      expect(m.saveProducts.mock.calls[0][0][0]).toMatchObject({
        promotionLink: HOT_LINK,
        source: "hot",
      });
    });

    it("takes productdetail's link once the list's link is older than LINK_MAX_AGE_DAYS", async () => {
      m.getProduct.mockResolvedValue(hotRow({ source: "hot" }, daysAgo(91)));
      detailsReturn({ ...PRODUCT, title: HOT_TITLE, promotionLink: FRESH_LINK });
      await productForPage(ID);
      expect(m.generateLinks).not.toHaveBeenCalled();
      expect(m.saveProducts.mock.calls[0][0][0].promotionLink).toBe(FRESH_LINK);
    });

    describe("with a hot link (promotionLinkType 2)", () => {
      const TYPE2_LINK = "https://s.click.aliexpress.com/e/_hot2";
      const NEW_TYPE2 = "https://s.click.aliexpress.com/e/_hot2new";
      /** A row the hot list gave a type 2 link `linkDays` ago; its data was saved 2 days ago. */
      const type2Row = (linkDays: number) =>
        hotRow(
          {
            source: "hot",
            promotionLink: TYPE2_LINK,
            promotionLinkType: 2,
            promotionLinkAt: daysAgo(linkDays),
            hotCommissionRatePct: 9,
          },
          daysAgo(Math.max(2, linkDays)),
        );
      // productdetail.get: a new price, its own /s/ link, and a hot rate of "0.0%".
      const refreshed = {
        ...PRODUCT,
        title: HOT_TITLE,
        price: 39.9,
        promotionLink: FRESH_LINK,
        hotCommissionRatePct: null,
      };

      it("keeps the hot link, its type and time over productdetail's link, with the fresh data", async () => {
        const row = type2Row(2);
        m.getProduct.mockResolvedValue(row);
        detailsReturn(refreshed);
        const data = await productForPage(ID);
        expect(m.generateLinks).not.toHaveBeenCalled();
        expect(m.saveProducts.mock.calls[0][0][0]).toEqual({
          ...refreshed,
          source: "hot",
          promotionLink: TYPE2_LINK,
          promotionLinkType: 2,
          promotionLinkAt: row.product.promotionLinkAt,
          // The hot rate the link was made for; productdetail.get sends none.
          hotCommissionRatePct: 9,
        });
        expect(data?.product.price_ils).toBe(39.9);
      });

      it("makes a new type 2 link once it is older than LINK_MAX_AGE_DAYS, 1.1 s later", async () => {
        m.getProduct.mockResolvedValue(type2Row(91));
        const at: number[] = [];
        m.getProductDetails.mockImplementation(async () => {
          at.push(Date.now());
          return { products: [refreshed], skipped: 0, totalRecords: 1 };
        });
        m.generateLinks.mockImplementation(async (_client, urls) => {
          at.push(Date.now());
          return [{ sourceValue: urls[0], promotionLink: NEW_TYPE2, message: null }];
        });
        const before = Date.now();
        await withFakeTimers(() => productForPage(ID));
        expect(m.generateLinks).toHaveBeenCalledTimes(1);
        expect(m.generateLinks).toHaveBeenCalledWith(
          expect.anything(),
          [`https://www.aliexpress.com/item/${ID}.html`],
          { promotionLinkType: 2 },
        );
        expect(at[1] - at[0]).toBeGreaterThanOrEqual(1_100);
        const saved = m.saveProducts.mock.calls[0][0][0];
        expect(saved).toMatchObject({
          price: 39.9,
          promotionLink: NEW_TYPE2,
          promotionLinkType: 2,
          hotCommissionRatePct: 9,
        });
        expect(Date.parse(saved.promotionLinkAt ?? "")).toBeGreaterThanOrEqual(before);
      });

      it("goes on with productdetail's link when the new type 2 link fails or is unusable", async () => {
        for (const answer of [
          () => Promise.reject(new Error("ApiCallLimit")),
          async () => [{ sourceValue: "x", promotionLink: "https://evil.test/r", message: null }],
        ]) {
          m.saveProducts.mockClear();
          m.getProduct.mockResolvedValue(type2Row(91));
          detailsReturn(refreshed);
          m.generateLinks.mockImplementationOnce(answer);
          const data = await withFakeTimers(() => productForPage(ID));
          expect(data?.product.product_id).toBe(ID);
          const saved = m.saveProducts.mock.calls[0][0][0];
          expect(saved.promotionLink).toBe(FRESH_LINK);
          expect(saved.promotionLinkType).toBeUndefined();
          expect(saved.promotionLinkAt).toBeUndefined();
          // The stored hot rate stays for stats; productdetail.get sends none.
          expect(saved.hotCommissionRatePct).toBe(9);
        }
      });
    });
  });
});

describe("productForPage: a refresh that fails or is throttled", () => {
  const MINUTE = 60_000;
  const FRESH_PRICE = 39.9;
  // The refresh guard remembers failures per product for this server instance, so every test
  // here uses a product id no other test used.
  let nextId = 1005008000000000;
  /** Stores a product last checked 2 days ago (so a view refreshes it); returns its id and row. */
  function staleRow() {
    const productId = String(nextId++);
    const row = stored({ ...PRODUCT, productId }, daysAgo(2));
    return { productId, row };
  }
  const freshPage = (productId: string): ProductPage => ({
    products: [{ ...PRODUCT, productId, price: FRESH_PRICE }],
    skipped: 0,
    totalRecords: 1,
  });

  beforeEach(() => {
    m.readCategoryTips.mockResolvedValue(entry(false));
  });

  it("serves the stored row, and makes no call for that product for 10 minutes", async () => {
    const { productId, row } = staleRow();
    m.getProduct.mockResolvedValue(row);
    m.getProductDetails.mockRejectedValue(new AliExpressError("network", "fetch failed"));
    vi.useFakeTimers({ now: Date.now() });
    try {
      for (let view = 0; view < 3; view++) {
        const data = await productForPage(productId);
        // The last refresh's data, with its date: never a 404 while AliExpress fails.
        expect(data?.product.price_ils).toBe(PRODUCT.price);
        expect(data?.updatedAt).toBe(row.updatedAt);
      }
      expect(m.getProductDetails).toHaveBeenCalledTimes(1);
      expect(m.saveProducts).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledTimes(1); // logged once, not per view

      vi.setSystemTime(Date.now() + 10 * MINUTE - 1);
      await productForPage(productId);
      expect(m.getProductDetails).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 1);
      m.getProductDetails.mockResolvedValue(freshPage(productId));
      expect((await productForPage(productId))?.product.price_ils).toBe(FRESH_PRICE);
      expect(m.getProductDetails).toHaveBeenCalledTimes(2);
      expect(m.saveProducts).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds every product back for a minute after an ApiCallLimit, serving stored rows", async () => {
    const a = staleRow();
    const b = staleRow();
    m.getProduct.mockImplementation(async (id: string) => (id === a.productId ? a.row : b.row));
    m.getProductDetails.mockRejectedValue(
      new AliExpressError("rate_limit", "Api access frequency exceeds the limit", {
        code: "ApiCallLimit",
      }),
    );
    vi.useFakeTimers({ now: Date.now() });
    try {
      expect((await productForPage(a.productId))?.updatedAt).toBe(a.row.updatedAt);
      // Another product, 59 s later: no call, its stored row.
      vi.setSystemTime(Date.now() + MINUTE - 1_000);
      const data = await productForPage(b.productId);
      expect(data?.product.product_id).toBe(b.productId);
      expect(data?.updatedAt).toBe(b.row.updatedAt);
      expect(m.getProductDetails).toHaveBeenCalledTimes(1);

      // Once the minute is over it is refreshed (which also ends the back-off).
      vi.setSystemTime(Date.now() + 1_000);
      m.getProductDetails.mockResolvedValue(freshPage(b.productId));
      expect((await productForPage(b.productId))?.product.price_ils).toBe(FRESH_PRICE);
      expect(m.getProductDetails).toHaveBeenCalledTimes(2);
      expect(m.getProductDetails).toHaveBeenLastCalledWith(expect.anything(), [b.productId], "EN");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets views that arrive together share one productdetail.get call and one save", async () => {
    const { productId, row } = staleRow();
    m.getProduct.mockResolvedValue(row);
    let answer: (page: ProductPage) => void = () => {};
    m.getProductDetails.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const views = [productForPage(productId), productForPage(productId), productForPage(productId)];
    await vi.waitFor(() => expect(m.getProductDetails).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0)); // the other views reach the refresh
    answer(freshPage(productId));
    const pages = await Promise.all(views);
    expect(pages.map((p) => p?.product.price_ils)).toEqual([FRESH_PRICE, FRESH_PRICE, FRESH_PRICE]);
    expect(m.getProductDetails).toHaveBeenCalledTimes(1);
    expect(m.saveProducts).toHaveBeenCalledTimes(1);
  });

  it("404s a product AliExpress no longer returns, without asking again for 10 minutes", async () => {
    const { productId, row } = staleRow();
    m.getProduct.mockResolvedValue(row);
    m.getProductDetails.mockResolvedValue({ products: [], skipped: 0, totalRecords: 0 });
    expect(await productForPage(productId)).toBeNull();
    expect(await productForPage(productId)).toBeNull();
    expect(m.getProductDetails).toHaveBeenCalledTimes(1);
    expect(m.saveProducts).not.toHaveBeenCalled();
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
    expect(m.logClick).toHaveBeenCalledWith(
      ID,
      "reviews",
      { searchUid: null, position: null },
      false,
    );
    expect(m.generateLinks).not.toHaveBeenCalled();
    expect(m.updates).toHaveLength(0);
  });

  it("logs a src it does not accept as 'other'", async () => {
    await clickOut(ID, "not a src!");
    expect(m.logClick).toHaveBeenCalledWith(
      ID,
      "other",
      { searchUid: null, position: null },
      false,
    );
  });

  it("marks the owner's own clicks, so the stats leave them out", async () => {
    m.getAdminUser.mockResolvedValue({ email: "owner@example.com" });
    await expect(clickOut(ID, "product")).resolves.toBe(PRODUCT.promotionLink);
    expect(m.logClick).toHaveBeenCalledWith(
      ID,
      "product",
      { searchUid: null, position: null },
      true,
    );
  });

  it("regenerates a link older than LINK_MAX_AGE_DAYS once and saves only the link", async () => {
    const updatedAt = daysAgo(91);
    const id = staleProduct({}, updatedAt);
    m.generateLinks.mockResolvedValue(linkResult(NEW_LINK, id));

    await expect(clickOut(id, "product")).resolves.toBe(NEW_LINK);
    expect(m.generateLinks).toHaveBeenCalledTimes(1);
    // A row without a hot link gets a standard link (type 0), as before.
    expect(m.generateLinks).toHaveBeenCalledWith(
      expect.anything(),
      [`https://www.aliexpress.com/item/${id}.html`],
      { promotionLinkType: 0 },
    );
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

  it("regenerates an old hot link with type 2, and the row stays marked", async () => {
    const updatedAt = daysAgo(120);
    const id = staleProduct(
      { source: "hot", promotionLinkType: 2, promotionLinkAt: daysAgo(91) },
      updatedAt,
    );
    m.generateLinks.mockResolvedValue(linkResult(NEW_LINK, id));
    await expect(clickOut(id, "product")).resolves.toBe(NEW_LINK);
    expect(m.generateLinks).toHaveBeenCalledWith(
      expect.anything(),
      [`https://www.aliexpress.com/item/${id}.html`],
      { promotionLinkType: 2 },
    );
    const data = m.updates[0].values.data as AliProduct;
    expect(data).toMatchObject({ promotionLink: NEW_LINK, promotionLinkType: 2 });
    expect(Date.parse(data.promotionLinkAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(m.updates[0].filters).toEqual([
      ["product_id", id],
      ["updated_at", updatedAt],
    ]);
  });

  it("keeps a hot link younger than LINK_MAX_AGE_DAYS without calling AliExpress", async () => {
    m.getProduct.mockResolvedValue(
      stored({ ...PRODUCT, promotionLinkType: 2, promotionLinkAt: daysAgo(89) }, daysAgo(120)),
    );
    await expect(clickOut(ID, "product")).resolves.toBe(PRODUCT.promotionLink);
    expect(m.generateLinks).not.toHaveBeenCalled();
  });

  it("reads only a stored type of exactly 2 as a hot link", async () => {
    const id = staleProduct({ promotionLinkType: "2" as unknown as 2 });
    m.generateLinks.mockResolvedValue(linkResult(NEW_LINK, id));
    await clickOut(id, "product");
    expect(m.generateLinks.mock.calls[0][2]).toEqual({ promotionLinkType: 0 });
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

describe("clickOut: the result card a click came from", () => {
  it("logs the search uid and position it is given", async () => {
    const ref = { searchUid: "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10", position: 2 };
    await expect(clickOut(ID, "search_compact", ref)).resolves.toBe(PRODUCT.promotionLink);
    expect(m.logClick).toHaveBeenCalledWith(ID, "search_compact", ref, false);
  });
});

describe("clickRefFrom (/go s= and pos=)", () => {
  const UID = "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10";
  const ref = (query: string) => clickRefFrom(new URLSearchParams(query));

  it("reads a UUID search uid and a 1-based position", () => {
    expect(ref("src=search_featured&s=" + UID + "&pos=1")).toEqual({ searchUid: UID, position: 1 });
    expect(ref("s=" + UID.toUpperCase() + "&pos=12")).toEqual({ searchUid: UID, position: 12 });
  });

  it("drops each bad value on its own, and a click without them is still a click", () => {
    expect(ref("src=product")).toEqual({ searchUid: null, position: null });
    expect(ref("s=123&pos=2")).toEqual({ searchUid: null, position: 2 });
    expect(ref("s=" + UID + "&pos=0")).toEqual({ searchUid: UID, position: null });
    for (const pos of ["-1", "1.5", "101", "abc", " "]) {
      expect(ref("pos=" + encodeURIComponent(pos)).position).toBeNull();
    }
    expect(ref("s=" + encodeURIComponent(UID + "' or 1=1")).searchUid).toBeNull();
  });
});

describe("failureCode (the code a failed search is answered and logged with)", () => {
  it("names a failure of the model 'llm', never AliExpress's 'upstream'", () => {
    expect(failureCode(new SearchError("llm", "parse call failed"))).toBe("llm");
    expect(failureCode(new APIConnectionTimeoutError())).toBe("llm");
    expect(failureCode(new AliExpressError("server", "AliExpress HTTP 503"))).toBe("upstream");
    expect(failureCode(new SearchError("upstream", "x"))).toBe("upstream");
    expect(failureCode(new Error("database is down"))).toBe("unavailable");
  });
});
