import { describe, expect, it } from "vitest";
import {
  atPostingTime,
  BUY_LINK_LINE,
  dealLines,
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
  final_price_approx: false,
};

describe("finalPrice", () => {
  it("takes the best single coupon that applies, by amount or percent", () => {
    expect(
      finalPrice(52.4, [
        { code: "A", offer: "", min_order_ils: 40, ends: null, off_ils: 10 },
        { code: "B", offer: "", min_order_ils: null, ends: null, off_pct: 25 },
      ]),
    ).toEqual({ price: 39.3, code: "B", approx: false });
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

describe("the post's format (owner's requests, 2026-10-24 and 11-02)", () => {
  it("built from the data: product, then the deal with the sales, feedback and link line", () => {
    const post = postFromData(INPUT);
    const blocks = post.split("\n\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatch(/^🔥 /);
    expect(blocks[1].split("\n")).toEqual([
      "💰 מחיר: ₪52.40 במקום ₪104.80 (50% הנחה)",
      "🎟️ קוד קופון: ILAFFC2 · ₪10 הנחה (בהזמנה מעל ₪40, עד 31.10)",
      "💰 מחיר סופי עם הקופון: ₪42.40",
      "🚚 משלוח חינם לישראל · 7-12 ימי משלוח לפי אלי אקספרס",
      "🛒 1,240 נמכרו ב־30 הימים האחרונים",
      "⭐ 97% משוב חיובי",
      BUY_LINK_LINE,
    ]);
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

describe("atPostingTime (the deal checked again and placed last, 2026-11-02)", () => {
  // A post queued in the old order: product, deal (a price since changed), benefits with feedback.
  const POST =
    "רובוט שואב במחיר מטורף!!!\nXiaomi H50.\n\n🎟️ קוד קופון: OLD\n💰 מחיר: ₪1381.67\nבמקום ₪4431.66\n68% הנחה\n🚚 משלוח חינם לישראל\n🔗 קישור לקנייה\n\n✅ שאיבה של 10000Pa\n✅ מיפוי לייזר\n✅ 96% משוב חיובי · 50 נמכרו";
  const DEAL = ["💰 מחיר: ₪1299", "🛒 60 נמכרו ב־30 הימים האחרונים", "🔗 קישור לקנייה"];

  it("keeps the product and its benefits, and puts the fresh deal under them", () => {
    expect(atPostingTime(POST, DEAL).split("\n")).toEqual([
      "רובוט שואב במחיר מטורף!!!",
      "Xiaomi H50.",
      "",
      "✅ שאיבה של 10000Pa",
      "✅ מיפוי לייזר",
      "",
      ...DEAL,
    ]);
  });

  it("drops benefits from the end to stay within the length, never the deal", () => {
    const out = atPostingTime(POST, DEAL, 120);
    expect(out).toContain("✅ שאיבה של 10000Pa");
    expect(out).not.toContain("מיפוי");
    expect(out.endsWith(DEAL.join("\n"))).toBe(true);
  });

  it("builds the deal from the data", () => {
    expect(dealLines({ ...INPUT, coupons: [], final_price_ils: null })[0]).toBe(
      "💰 מחיר: ₪52.40 במקום ₪104.80 (50% הנחה)",
    );
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
