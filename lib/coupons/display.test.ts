import { describe, expect, it } from "vitest";
import { parsePromoCode, type AliPromoCode } from "@/lib/aliexpress/promo-code";
import {
  apiOfferParts,
  couponTiming,
  formatIsraelTime,
  formatTimeLeft,
  minSpendText,
  timeOfDay,
} from "./display";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const window = (starts_at: string | null, ends_at: string | null) => ({ starts_at, ends_at });

describe("couponTiming", () => {
  it("says when a coupon that has not started starts", () => {
    expect(couponTiming(window("2026-11-11T08:00:00.000Z", null), NOW)).toEqual({
      state: "upcoming",
      startsAt: "2026-11-11T08:00:00.000Z",
    });
  });

  it("counts down to the end of a running coupon", () => {
    expect(couponTiming(window(null, "2026-10-04T12:00:00.000Z"), NOW)).toEqual({
      state: "ending",
      endsAt: "2026-10-04T12:00:00.000Z",
      left: "3 ימים",
    });
    expect(couponTiming(window("2026-10-01T09:00:00.000Z", "2026-10-01T14:30:00Z"), NOW)).toEqual({
      state: "ending",
      endsAt: "2026-10-01T14:30:00Z",
      left: "5 שעות",
    });
  });

  it("has no countdown without an end date, and is over once the end is reached", () => {
    expect(couponTiming(window(null, null), NOW)).toEqual({ state: "open" });
    expect(couponTiming(window(null, "2026-10-01T09:00:00.000Z"), NOW)).toEqual({
      state: "ended",
    });
  });
});

describe("formatTimeLeft", () => {
  it("uses the largest whole unit, with the Hebrew dual forms", () => {
    const left = (days: number, hours: number, minutes: number) =>
      formatTimeLeft({ days, hours, minutes });
    expect(left(12, 5, 0)).toBe("12 ימים");
    expect(left(2, 23, 59)).toBe("יומיים");
    expect(left(1, 20, 0)).toBe("יום");
    expect(left(0, 5, 10)).toBe("5 שעות");
    expect(left(0, 2, 0)).toBe("שעתיים");
    expect(left(0, 1, 59)).toBe("שעה");
    expect(left(0, 0, 12)).toBe("12 דקות");
    expect(left(0, 0, 1)).toBe("דקה");
    expect(left(0, 0, 0)).toBe("פחות מדקה");
  });
});

describe("minSpendText", () => {
  it("writes the minimum in shekels, and nothing without one", () => {
    expect(minSpendText(40)).toBe("בהזמנה מעל ₪40");
    expect(minSpendText(39.9)).toBe("בהזמנה מעל ₪39.90");
    expect(minSpendText(0)).toBeNull();
    expect(minSpendText(null)).toBeNull();
  });
});

describe("apiOfferParts", () => {
  const PROMO: AliPromoCode = {
    code: "ILSALE3",
    offerText: "On order over ILS 62.2 , get ILS 3.11 off",
    offer: { kind: "amount", off: 3.11, minSpend: 62.2, currency: "ILS" },
    minSpend: 62.2,
    startsAt: null,
    endsAt: null,
    promotionUrl: null,
  };
  // Through the real parser, as the product refresh stores it.
  const parsed = (code_value: string, code_mini_spend: string) => {
    const promo = parsePromoCode({ promo_code: "SAVE5NOW", code_value, code_mini_spend });
    if (!promo) throw new Error("the sample should parse");
    return promo;
  };

  it("states shekel offers from AliExpress's numbers", () => {
    expect(apiOfferParts(PROMO)).toEqual({ off: "₪3.11", minSpend: "₪62.20", text: null });
    expect(apiOfferParts(parsed("On order over ILS 100 , get 5% off", "100"))).toEqual({
      off: "5%",
      minSpend: "₪100",
      text: null,
    });
    expect(apiOfferParts(parsed("10% off", "40"))).toEqual({
      off: "10%",
      minSpend: "₪40",
      text: null,
    });
  });

  it("treats a minimum of 0 as no minimum", () => {
    expect(apiOfferParts(parsed("5% off", "0"))).toEqual({ off: "5%", minSpend: null, text: null });
  });

  it("states no ₪ amount for an offer in another currency, and shows AliExpress's words", () => {
    const promo = parsed("On order over USD 20 , get USD 3 off", "20");
    expect(apiOfferParts(promo)).toEqual({
      off: null,
      minSpend: null,
      text: "On order over USD 20 , get USD 3 off",
    });
    expect(JSON.stringify(apiOfferParts(promo))).not.toContain("₪");
  });

  it("shows an offer text no pattern matched as written, with no minimum of its own", () => {
    expect(apiOfferParts(parsed("Get a gift over ILS 20", "20"))).toEqual({
      off: null,
      minSpend: null,
      text: "Get a gift over ILS 20",
    });
    // Without any text, code_mini_spend (the request currency, ILS) is all there is to say.
    expect(apiOfferParts({ offer: null, offerText: null, minSpend: 20 })).toEqual({
      off: null,
      minSpend: "₪20",
      text: null,
    });
    expect(apiOfferParts({ offer: null, offerText: null, minSpend: null })).toEqual({
      off: null,
      minSpend: null,
      text: null,
    });
  });
});

describe("Israel time of day", () => {
  it("reads the wall clock in Israel, and hides midnight", () => {
    expect(formatIsraelTime("2026-11-11T08:00:00.000Z")).toBe("10:00");
    expect(formatIsraelTime("2026-07-01T09:05:00.000Z")).toBe("12:05");
    expect(timeOfDay("2026-11-10T22:00:00.000Z")).toBeNull();
    expect(timeOfDay("2026-11-11T21:59:00.000Z")).toBe("23:59");
  });
});
