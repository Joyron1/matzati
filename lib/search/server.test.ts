// productForPage wiring for /p: stored tips, background refresh with after(), and the community
// coupon. Database, deals and the refresher are faked; nothing here reaches Supabase or an LLM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { TIPS_VERSION } from "@/lib/llm/tips";
import type { TipsEntry } from "@/lib/tips/store";
import { TipsStoreError } from "@/lib/tips/store";
import type { Deal } from "@/lib/types";
import { productForPage } from "./server";

const m = vi.hoisted(() => ({
  after: vi.fn<(job: () => unknown) => void>(),
  getProduct: vi.fn(),
  couponForProduct: vi.fn<(productId: string, now: Date) => Promise<Deal | null>>(),
  readCategoryTips: vi.fn<(categoryId: string, now: Date) => Promise<TipsEntry | null>>(),
  refresh: vi.fn(async () => {}),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));
vi.mock("./supabase-store", () => ({
  SupabaseStore: class {
    getProduct = m.getProduct;
    saveProducts = async () => {};
  },
}));
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

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.getProduct.mockResolvedValue({
    product: PRODUCT,
    titleHe: "אוזניות אלחוטיות",
    updatedAt: new Date().toISOString(),
  });
  m.couponForProduct.mockResolvedValue(null);
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
