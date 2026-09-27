import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "./client";
import {
  isPromoCodeCurrent,
  parseOffer,
  parsePromoCode,
  readStoredPromoCode,
  type AliPromoCode,
} from "./promo-code";
import { unwrapList } from "./unwrap";

// The only real promo_code_info we have: featuredpromo.products.get, 2026-09-28 (masked fixture).
function samplePromoCodeInfo(): unknown {
  const method = "aliexpress.affiliate.featuredpromo.products.get";
  const text = readFileSync(`fixtures/aliexpress/probe-extras/${method}.json`, "utf8");
  const result = parseEnvelope(method, parseJsonKeepingIds(text)).result as { products: unknown };
  const withCode = unwrapList(result.products, "product").filter(
    (p) => (p as Record<string, unknown>).promo_code_info,
  );
  expect(withCode).toHaveLength(1);
  return (withCode[0] as Record<string, unknown>).promo_code_info;
}

describe("parsePromoCode: the real sample", () => {
  const code = parsePromoCode(samplePromoCodeInfo());

  it("reads the code, the offer from code_value and the minimum spend", () => {
    expect(code).toMatchObject({
      code: "AJO7RM0ITRX2",
      offerText: "On order over ILS 62.2 , get ILS 3.11 off",
      offer: { kind: "amount", off: 3.11, minSpend: 62.2, currency: "ILS" },
      minSpend: 62.2,
      promotionUrl: null,
    });
  });

  it("never carries code_quantity or code_campaigntype", () => {
    expect(Object.keys(code ?? {}).sort()).toEqual(
      ["code", "endsAt", "minSpend", "offer", "offerText", "promotionUrl", "startsAt"].sort(),
    );
    expect(JSON.stringify(code)).not.toContain("19999");
  });

  // Runs the real zonedLocalToIso (lib/deals/time.ts), not a fake. The docs say "PST" without
  // saying whether PDT applies, so the window is read on the safe side: the start (2026-08-18
  // 00:00, PDT season) as fixed UTC-8, one hour later than a PDT reading; the end (2026-12-31
  // 23:59:59, PST season) where both readings agree.
  it("converts the Pacific-time window to UTC, starting late rather than early", () => {
    expect(code?.startsAt).toBe("2026-08-18T08:00:00.000Z");
    expect(code?.endsAt).toBe("2027-01-01T07:59:59.000Z");
  });
});

describe("parsePromoCode: the window in the PDT season", () => {
  it("ends by the PDT reading, the earlier of the two", () => {
    const code = parsePromoCode({
      promo_code: "SUMMER5",
      code_availabletime_start: "2026-07-01 00:00:00",
      code_availabletime_end: "2026-07-31 23:59:59",
    });
    // Start at 08:00Z (UTC-8), not 07:00Z (PDT); end at 06:59:59Z (PDT), not 07:59:59Z (UTC-8).
    expect(code).toMatchObject({
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-08-01T06:59:59.000Z",
    });
  });
});

describe("readStoredPromoCode", () => {
  const STORED: AliPromoCode = {
    code: "AJO7RM0ITRX2",
    offerText: "On order over ILS 62.2 , get ILS 3.11 off",
    offer: { kind: "amount", off: 3.11, minSpend: 62.2, currency: "ILS" },
    minSpend: 62.2,
    startsAt: "2026-08-18T08:00:00.000Z",
    endsAt: "2027-01-01T07:59:59.000Z",
    promotionUrl: null,
  };

  it("reads back what parsePromoCode stored", () => {
    expect(readStoredPromoCode(STORED)).toEqual(STORED);
    expect(readStoredPromoCode(parsePromoCode(samplePromoCodeInfo()))).toEqual(
      parsePromoCode(samplePromoCodeInfo()),
    );
  });

  it("applies the parser's rules again to the stored jsonb", () => {
    expect(readStoredPromoCode({ ...STORED, code: "<script>" })).toBeNull();
    expect(readStoredPromoCode({ ...STORED, endsAt: "soon" })).toBeNull();
    expect(readStoredPromoCode(null)).toBeNull();
    expect(readStoredPromoCode(undefined)).toBeNull();
    // An unreadable offer is dropped and the text stays; a URL off AliExpress is dropped.
    expect(
      readStoredPromoCode({
        ...STORED,
        offer: { kind: "bogo" },
        promotionUrl: "https://evil.test/x",
      }),
    ).toEqual({ ...STORED, offer: null, promotionUrl: null });
  });
});

describe("parsePromoCode: lenient input", () => {
  const base = { promo_code: "SAVE5NOW" };

  it("keeps the code without an offer when code_value matches no known form", () => {
    const code = parsePromoCode({ ...base, code_value: "Get a gift", code_mini_spend: "20" });
    expect(code).toMatchObject({ code: "SAVE5NOW", offerText: "Get a gift", offer: null });
    expect(code?.minSpend).toBe(20);
  });

  it("treats missing fields as null and accepts numbers as text", () => {
    expect(parsePromoCode({ ...base, code_mini_spend: 15 })).toEqual({
      code: "SAVE5NOW",
      offerText: null,
      offer: null,
      minSpend: 15,
      startsAt: null,
      endsAt: null,
      promotionUrl: null,
    });
  });

  it("returns null without a usable code or for a value that is not an object", () => {
    expect(parsePromoCode(undefined)).toBeNull();
    expect(parsePromoCode("")).toBeNull();
    expect(parsePromoCode([base])).toBeNull();
    expect(parsePromoCode({ code_value: "5% off" })).toBeNull();
    expect(parsePromoCode({ promo_code: "  " })).toBeNull();
    expect(parsePromoCode({ promo_code: "<script>" })).toBeNull();
    expect(parsePromoCode({ promo_code: { nested: true } })).toBeNull();
  });

  it("drops a date that is not a real date and time", () => {
    const code = parsePromoCode({ ...base, code_availabletime_end: "2026-02-30 25:00:00" });
    expect(code?.endsAt).toBeNull();
  });

  it("keeps code_promotionurl only as an https AliExpress URL", () => {
    const url = (v: string) => parsePromoCode({ ...base, code_promotionurl: v })?.promotionUrl;
    expect(url("https://s.click.aliexpress.com/e/_abc")).toBe(
      "https://s.click.aliexpress.com/e/_abc",
    );
    expect(url("http://s.click.aliexpress.com/e/_abc")).toBeNull();
    expect(url("https://aliexpress.com.evil.test/x")).toBeNull();
    expect(url("not a url")).toBeNull();
  });
});

describe("parseOffer", () => {
  it("reads a fixed amount over a minimum, with loose spacing", () => {
    expect(parseOffer("On order over ILS 62.2 , get ILS 3.11 off")).toEqual({
      kind: "amount",
      off: 3.11,
      minSpend: 62.2,
      currency: "ILS",
    });
    expect(parseOffer("On order over USD 20, get USD 3 off")).toMatchObject({ off: 3 });
  });

  it("reads percent forms", () => {
    expect(parseOffer("5% off")).toEqual({
      kind: "percent",
      pct: 5,
      minSpend: null,
      currency: null,
    });
    expect(parseOffer("On order over ILS 100 , get 12.5% off")).toEqual({
      kind: "percent",
      pct: 12.5,
      minSpend: 100,
      currency: "ILS",
    });
  });

  it("rejects anything else, and numbers that make no sense", () => {
    expect(parseOffer(null)).toBeNull();
    expect(parseOffer("")).toBeNull();
    expect(parseOffer("Get ILS 3 off")).toBeNull();
    expect(parseOffer("On order over ILS 62.2 , get USD 3.11 off")).toBeNull(); // mixed currency
    expect(parseOffer("On order over ILS 5 , get ILS 5 off")).toBeNull(); // nothing left to pay
    expect(parseOffer("On order over ILS 10 , get ILS 0 off")).toBeNull();
    expect(parseOffer("100% off")).toBeNull();
    expect(parseOffer("0% off")).toBeNull();
    expect(parseOffer("up to 50% off")).toBeNull();
    expect(parseOffer("5% off everything")).toBeNull();
  });
});

describe("isPromoCodeCurrent", () => {
  const window = { startsAt: "2026-08-18T07:00:00.000Z", endsAt: "2027-01-01T07:59:59.000Z" };

  it("is true from the start up to (not including) the end", () => {
    expect(isPromoCodeCurrent(window, new Date("2026-08-18T07:00:00.000Z"))).toBe(true);
    expect(isPromoCodeCurrent(window, new Date("2026-09-28T12:00:00.000Z"))).toBe(true);
    expect(isPromoCodeCurrent(window, new Date("2027-01-01T07:59:59.000Z"))).toBe(false);
    expect(isPromoCodeCurrent(window, new Date("2026-08-18T06:59:59.000Z"))).toBe(false);
  });

  it("is false when either end is unknown", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    expect(isPromoCodeCurrent({ ...window, startsAt: null }, now)).toBe(false);
    expect(isPromoCodeCurrent({ ...window, endsAt: null }, now)).toBe(false);
  });
});
