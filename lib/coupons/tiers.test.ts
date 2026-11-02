import { describe, expect, it } from "vitest";
import { ownerCouponAmount } from "@/lib/agents/finder/write";
import { bestSitewideCoupon, usdTier } from "./tiers";
import type { Coupon } from "./types";

function coupon(code: string, title: string, extra: Partial<Coupon> = {}): Coupon {
  return {
    id: code,
    code,
    title,
    terms: null,
    min_spend_ils: null,
    scope: "sitewide",
    product_id: null,
    sale_id: null,
    starts_at: null,
    ends_at: "2026-11-18T21:00:00Z",
    featured: false,
    published: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...extra,
  };
}

const TIERS = [
  coupon("ILAFF02", "US$2 הנחה בהזמנה מעל US$15"),
  coupon("ILAFF12", "US$12 הנחה בהזמנה מעל US$65"),
  coupon("ILAFF60", "US$60 הנחה בהזמנה מעל US$349"),
];

describe("usdTier", () => {
  it("reads the dollars off and the dollar minimum", () => {
    expect(usdTier("US$12 הנחה בהזמנה מעל US$65")).toEqual({ offUsd: 12, minUsd: 65 });
    expect(usdTier("$5 הנחה בקנייה מעל $29")).toEqual({ offUsd: 5, minUsd: 29 });
    expect(usdTier("₪10 הנחה")).toBeNull();
  });
});

describe("bestSitewideCoupon", () => {
  it("takes the biggest tier whose minimum the price meets", () => {
    const pick = bestSitewideCoupon(TIERS, 1381.67, 3.2, ownerCouponAmount);
    expect(pick?.coupon.code).toBe("ILAFF60");
    expect(pick).toMatchObject({ offIls: 192, approx: true });
    expect(bestSitewideCoupon(TIERS, 250, 3.2, ownerCouponAmount)?.coupon.code).toBe("ILAFF12");
  });

  it("keeps a margin over the minimum, and names none under the smallest", () => {
    // US$15 at 3.2 is ₪48: ₪48.50 is within the 3% margin.
    expect(bestSitewideCoupon(TIERS, 48.5, 3.2, ownerCouponAmount)).toBeNull();
    expect(bestSitewideCoupon(TIERS, 20.69, 3.2, ownerCouponAmount)).toBeNull();
  });

  it("reads an owner's shekel coupon with its minimum, never a product coupon", () => {
    const own = [
      coupon("SHEKEL", "₪10 הנחה", { min_spend_ils: 40 }),
      coupon("PROD", "₪50 הנחה", { scope: "product", product_id: "1" }),
    ];
    expect(bestSitewideCoupon(own, 52, 3.2, ownerCouponAmount)).toMatchObject({
      coupon: { code: "SHEKEL" },
      offIls: 10,
      approx: false,
    });
    expect(bestSitewideCoupon(own, 30, 3.2, ownerCouponAmount)).toBeNull();
  });
});
