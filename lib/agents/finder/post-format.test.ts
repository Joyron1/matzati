import { describe, expect, it } from "vitest";
import {
  BUY_LINK_LINE,
  finalPrice,
  ownerCouponAmount,
  postFromData,
  withBuyLink,
  type WriterInput,
} from "./write";

const INPUT: WriterInput = {
  id: "1005007636277321",
  title_he: "מטען נייד מגנטי Vention 10000mAh עם טעינה מהירה 22.5W",
  category_he: "אלקטרוניקה",
  price_ils: 52.4,
  original_price_ils: 104.8,
  discount_pct: 50,
  positive_feedback_pct: 97,
  units_sold_30d: 1240,
  coupons: [{ code: "ILAFFC2", offer: "₪10 הנחה", min_order_ils: 40, ends: "31.10", off_ils: 10 }],
  free_shipping_il: true,
  delivery_days_min: 7,
  delivery_days_max: 12,
  final_price_ils: 42.4,
  final_price_code: "ILAFFC2",
};

describe("finalPrice", () => {
  it("takes the best single coupon that applies, by amount or percent", () => {
    expect(
      finalPrice(52.4, [
        { code: "A", offer: "", min_order_ils: 40, ends: null, off_ils: 10 },
        { code: "B", offer: "", min_order_ils: null, ends: null, off_pct: 25 },
      ]),
    ).toEqual({ price: 39.3, code: "B" });
  });

  it("skips a coupon whose minimum the price does not meet, or whose amount is unknown", () => {
    expect(
      finalPrice(30, [{ code: "A", offer: "", min_order_ils: 40, ends: null, off_ils: 5 }]),
    ).toBeNull();
    expect(
      finalPrice(30, [{ code: "A", offer: "קופון", min_order_ils: null, ends: null }]),
    ).toBeNull();
  });
});

describe("the post's format (owner's example, 2026-10-24)", () => {
  it("built from the data: product, then the deal with the final price and link line, then the benefits", () => {
    const post = postFromData(INPUT);
    const blocks = post.split("\n\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatch(/^🔥 /);
    expect(blocks[1]).toContain("🎟️ קוד קופון: ILAFFC2");
    expect(blocks[1]).toContain("💰 מחיר סופי עם הקופון: ₪42.40 במקום ₪104.80");
    expect(blocks[1]).toContain("🚚 משלוח חינם לישראל");
    expect(blocks[1].split("\n").at(-1)).toBe(BUY_LINK_LINE);
    expect(blocks[2]).toMatch(/^✅ 97% משוב חיובי/);
  });

  it("puts the buy link on the 🔗 line, or after the price when the line is missing", () => {
    const url = "https://www.matzati-il.com/go/1?src=telegram";
    expect(withBuyLink(postFromData(INPUT), url)).toContain(`🔗 לקנייה: ${url}`);
    expect(withBuyLink(postFromData(INPUT), url)).not.toContain(BUY_LINK_LINE);
    expect(withBuyLink("hook\n💰 מחיר: ₪5\n✅ טוב", url)).toBe(
      `hook\n💰 מחיר: ₪5\n🔗 לקנייה: ${url}\n✅ טוב`,
    );
    expect(withBuyLink("hook", url)).toBe(`hook\n🔗 לקנייה: ${url}`);
  });
});

describe("ownerCouponAmount", () => {
  it("reads an amount or a percent from an owner's coupon title", () => {
    expect(ownerCouponAmount("₪5 הנחה")).toEqual({ off_ils: 5, off_pct: null });
    expect(ownerCouponAmount("10 ש״ח הנחה בקנייה מעל 50")).toEqual({ off_ils: 10, off_pct: null });
    expect(ownerCouponAmount("15% הנחה")).toEqual({ off_ils: null, off_pct: 15 });
    expect(ownerCouponAmount("קופון חגים")).toEqual({ off_ils: null, off_pct: null });
  });
});
