import { describe, expect, it } from "vitest";
import { couponsForPost, couponsMessage, plainPreview } from "./telegram";
import type { Coupon } from "./types";

const NOW = new Date("2026-11-02T10:00:00Z");
const END = "2026-11-18T21:00:00Z";

function coupon(over: Partial<Coupon>): Coupon {
  return {
    id: over.code ?? "x",
    code: "ILAFF02",
    title: "US$2 הנחה בהזמנה מעל US$15",
    terms: null,
    min_spend_ils: null,
    scope: "sitewide",
    product_id: null,
    sale_id: null,
    starts_at: null,
    ends_at: END,
    featured: false,
    published: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

const LINKS = {
  buyUrl: "https://s.click.aliexpress.com/e/_abc",
  pageUrl: "https://www.matzati-il.com/coupons",
};

describe("couponsForPost", () => {
  it("keeps sitewide coupons valid now, by the title's first number", () => {
    const list = couponsForPost(
      [
        coupon({ code: "ILAFF12", title: "US$12 הנחה בהזמנה מעל US$65" }),
        coupon({ code: "ILAFF02" }),
        coupon({ code: "PROD", scope: "product", product_id: "1" }),
        coupon({ code: "OLD", ends_at: "2026-11-01T00:00:00Z" }),
        coupon({ code: "LATER", starts_at: "2026-11-11T00:00:00Z" }),
      ],
      NOW,
    );
    expect(list.map((c) => c.code)).toEqual(["ILAFF02", "ILAFF12"]);
  });
});

describe("couponsMessage", () => {
  it("lists each code to copy, the shared end, the affiliate link and the disclosure", () => {
    const text = couponsMessage(
      [coupon({}), coupon({ code: "ILAFF05", title: "US$5 הנחה" })],
      LINKS,
    )!;
    expect(text).toContain("<code>ILAFF02</code>: US$2 הנחה בהזמנה מעל US$15");
    expect(text).toContain("<code>ILAFF05</code>");
    expect(text).toContain("⏰ בתוקף עד 18.11 בשעה 23:00");
    expect(text).toContain(`<a href="${LINKS.buyUrl}">`);
    expect(text).toContain("קישור שותפים");
  });

  it("puts each end date on its line when they differ", () => {
    const text = couponsMessage(
      [coupon({}), coupon({ code: "B", ends_at: "2026-11-12T21:00:00Z" })],
      LINKS,
    )!;
    expect(text).not.toContain("⏰");
    expect(text).toContain("(עד 12.11 בשעה 23:00)");
  });

  it("escapes the owner's text and is null without coupons", () => {
    expect(couponsMessage([coupon({ title: "<b>x</b> & y" })], LINKS)).toContain(
      "&lt;b&gt;x&lt;/b&gt; &amp; y",
    );
    expect(couponsMessage([], LINKS)).toBeNull();
  });

  it("previews as plain text", () => {
    const preview = plainPreview(couponsMessage([coupon({})], LINKS)!);
    expect(preview).toContain("ILAFF02: US$2");
    expect(preview).toContain("לקנייה באלי אקספרס ←");
    expect(preview).not.toMatch(/<\/?[a-z]/);
  });
});
