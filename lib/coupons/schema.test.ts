import { describe, expect, it } from "vitest";
import { PRODUCT_ID_ERRORS } from "@/lib/deals/product-id";
import {
  COUPON_ERRORS,
  formValuesFromCoupon,
  parseCouponForm,
  parseMinSpend,
  readCouponFormValues,
  validateCouponInput,
  type CouponFormValues,
} from "./schema";
import type { Coupon, CouponInput } from "./types";

const SALE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const VALID: CouponInput = {
  code: "IL_SALE-5",
  title: "₪5 הנחה בהזמנה מעל ₪40",
  terms: "למשתמשים חדשים בלבד.",
  min_spend_ils: 40,
  scope: "product",
  product_id: "1005006123456789",
  sale_id: SALE_ID,
  starts_at: "2026-11-11T00:00:00+02:00",
  ends_at: "2026-11-13T23:59:00+02:00",
  featured: true,
};

const FORM: CouponFormValues = {
  code: " IL5 ",
  title: "  ₪5 הנחה לכל האתר  ",
  terms: "   ",
  min_spend: "",
  scope: "sitewide",
  product: "",
  sale_id: "",
  starts_at: "2026-11-11T00:00",
  ends_at: "2026-11-13T23:59",
  featured: false,
};

describe("validateCouponInput", () => {
  it("accepts a valid coupon, trimming text and normalizing dates to UTC", () => {
    const result = validateCouponInput({
      ...VALID,
      title: `  ${VALID.title} `,
      code: " IL_SALE-5",
    });
    expect(result).toEqual({
      ok: true,
      input: {
        ...VALID,
        starts_at: "2026-11-10T22:00:00.000Z",
        ends_at: "2026-11-13T21:59:00.000Z",
      },
    });
  });

  it("accepts a sitewide coupon with every optional field empty", () => {
    const input: CouponInput = {
      ...VALID,
      scope: "sitewide",
      product_id: null,
      terms: null,
      min_spend_ils: null,
      sale_id: null,
      starts_at: null,
      ends_at: null,
      featured: false,
    };
    expect(validateCouponInput(input)).toEqual({ ok: true, input });
    expect(validateCouponInput({ ...input, terms: "  " })).toEqual({ ok: true, input });
  });

  it("checks the code format (the same rule as the migration)", () => {
    for (const code of ["SAVE 5", "קופון", "a".repeat(41), "", "50%", "A.B"]) {
      expect(validateCouponInput({ ...VALID, code }), code).toMatchObject({
        ok: false,
        errors: { code: COUPON_ERRORS.code },
      });
    }
    expect(validateCouponInput({ ...VALID, code: "a".repeat(40) }).ok).toBe(true);
  });

  it("checks the title (3-120) and terms (up to 1000) lengths", () => {
    expect(validateCouponInput({ ...VALID, title: " אב " })).toEqual({
      ok: false,
      errors: { title: COUPON_ERRORS.title },
    });
    expect(validateCouponInput({ ...VALID, title: "א".repeat(120) }).ok).toBe(true);
    expect(validateCouponInput({ ...VALID, title: "א".repeat(121) }).ok).toBe(false);
    expect(validateCouponInput({ ...VALID, terms: "א".repeat(1000) }).ok).toBe(true);
    expect(validateCouponInput({ ...VALID, terms: "א".repeat(1001) })).toEqual({
      ok: false,
      errors: { terms: COUPON_ERRORS.terms },
    });
  });

  it("wants a minimum spend of zero or more in whole agorot", () => {
    for (const min of [0, 39.9, 39.99, 100_000]) {
      expect(validateCouponInput({ ...VALID, min_spend_ils: min }).ok, String(min)).toBe(true);
    }
    for (const min of [-1, 39.999, Number.NaN, Number.POSITIVE_INFINITY, 100_001]) {
      expect(validateCouponInput({ ...VALID, min_spend_ils: min }), String(min)).toMatchObject({
        ok: false,
        errors: { min_spend_ils: COUPON_ERRORS.minSpend },
      });
    }
  });

  it("ties the scope to the product id", () => {
    expect(validateCouponInput({ ...VALID, product_id: null })).toEqual({
      ok: false,
      errors: { product_id: COUPON_ERRORS.productRequired },
    });
    expect(validateCouponInput({ ...VALID, scope: "sitewide" })).toEqual({
      ok: false,
      errors: { product_id: COUPON_ERRORS.sitewideProduct },
    });
    expect(validateCouponInput({ ...VALID, product_id: "12a" })).toEqual({
      ok: false,
      errors: { product_id: COUPON_ERRORS.productId },
    });
    expect(validateCouponInput({ ...VALID, scope: "store" })).toMatchObject({
      ok: false,
      errors: { scope: COUPON_ERRORS.scope },
    });
  });

  it("wants a uuid sale id, ISO dates with an offset and an end not before the start", () => {
    expect(validateCouponInput({ ...VALID, sale_id: "11.11" })).toEqual({
      ok: false,
      errors: { sale_id: COUPON_ERRORS.sale },
    });
    expect(validateCouponInput({ ...VALID, starts_at: "2026-11-11" })).toMatchObject({
      ok: false,
      errors: { starts_at: COUPON_ERRORS.date },
    });
    expect(
      validateCouponInput({ ...VALID, starts_at: VALID.ends_at, ends_at: VALID.starts_at }),
    ).toEqual({ ok: false, errors: { ends_at: COUPON_ERRORS.order } });
    expect(validateCouponInput({ ...VALID, ends_at: VALID.starts_at }).ok).toBe(true);
  });

  it("rejects input that is not an object, and a featured flag that is not a boolean", () => {
    expect(validateCouponInput(null).ok).toBe(false);
    expect(validateCouponInput("IL5").ok).toBe(false);
    expect(validateCouponInput({ ...VALID, featured: "on" }).ok).toBe(false);
  });
});

describe("parseMinSpend", () => {
  it("reads shekels with up to two decimals, ignoring ₪, spaces and thousands commas", () => {
    expect(parseMinSpend("40")).toBe(40);
    expect(parseMinSpend("39.90")).toBe(39.9);
    expect(parseMinSpend(" ₪1,000 ")).toBe(1000);
    expect(parseMinSpend("0")).toBe(0);
  });

  it("rejects anything else", () => {
    for (const v of ["", "-5", "39.999", "abc", "1e3", "40 ש״ח", "1234567"]) {
      expect(parseMinSpend(v), v).toBeNull();
    }
  });
});

describe("parseCouponForm", () => {
  it("turns empty optional fields into null and reads dates as Israel time", () => {
    expect(parseCouponForm(FORM)).toEqual({
      ok: true,
      input: {
        code: "IL5",
        title: "₪5 הנחה לכל האתר",
        terms: null,
        min_spend_ils: null,
        scope: "sitewide",
        product_id: null,
        sale_id: null,
        starts_at: "2026-11-10T22:00:00.000Z",
        ends_at: "2026-11-13T21:59:00.000Z",
        featured: false,
      },
    });
  });

  it("takes the product id from a pasted link, the minimum from shekels and the sale id", () => {
    const result = parseCouponForm({
      ...FORM,
      scope: "product",
      product: "https://he.aliexpress.com/item/1005006123456789.html?spm=x",
      min_spend: "₪39.90",
      sale_id: SALE_ID,
      featured: true,
    });
    expect(result).toMatchObject({
      ok: true,
      input: {
        scope: "product",
        product_id: "1005006123456789",
        min_spend_ils: 39.9,
        sale_id: SALE_ID,
        featured: true,
      },
    });
  });

  it("drops the product field of a sitewide coupon", () => {
    expect(parseCouponForm({ ...FORM, product: "1005006123456789" })).toMatchObject({
      ok: true,
      input: { scope: "sitewide", product_id: null },
    });
  });

  it("explains what is wrong with the product field", () => {
    expect(parseCouponForm({ ...FORM, scope: "product" })).toEqual({
      ok: false,
      errors: { product_id: COUPON_ERRORS.productRequired },
    });
    expect(
      parseCouponForm({ ...FORM, scope: "product", product: "https://a.aliexpress.com/_mK1" }),
    ).toEqual({ ok: false, errors: { product_id: PRODUCT_ID_ERRORS.short_link } });
  });

  it("collects errors from every field at once", () => {
    expect(
      parseCouponForm({
        ...FORM,
        code: "SAVE 5",
        title: "א",
        min_spend: "ארבעים",
        starts_at: "2026-02-30T10:00",
      }),
    ).toEqual({
      ok: false,
      errors: {
        code: COUPON_ERRORS.code,
        title: COUPON_ERRORS.title,
        min_spend_ils: COUPON_ERRORS.minSpend,
        starts_at: COUPON_ERRORS.date,
      },
    });
    expect(
      parseCouponForm({ ...FORM, starts_at: "2026-11-13T00:00", ends_at: "2026-11-11T00:00" }),
    ).toEqual({ ok: false, errors: { ends_at: COUPON_ERRORS.order } });
  });
});

describe("form values", () => {
  it("reads every field from FormData, the checkbox as a boolean", () => {
    const data = new FormData();
    data.set("code", "IL5");
    data.set("scope", "product");
    data.set("featured", "on");
    data.set("$ACTION_ID_abc", "");
    expect(readCouponFormValues(data)).toEqual({
      code: "IL5",
      title: "",
      terms: "",
      min_spend: "",
      scope: "product",
      product: "",
      sale_id: "",
      starts_at: "",
      ends_at: "",
      featured: true,
    });
    expect(readCouponFormValues(new FormData()).featured).toBe(false);
  });

  it("fills the edit form from a saved coupon, in Israel time, and parses back to it", () => {
    const coupon: Coupon = {
      ...VALID,
      id: "00000000-0000-4000-8000-000000000001",
      min_spend_ils: 39.9,
      starts_at: "2026-11-10T22:00:00.000Z",
      ends_at: null,
      published: true,
      created_at: "2026-09-28T10:00:00.000Z",
      updated_at: "2026-09-28T10:00:00.000Z",
    };
    const values = formValuesFromCoupon(coupon);
    expect(values).toEqual({
      code: "IL_SALE-5",
      title: VALID.title,
      terms: VALID.terms,
      min_spend: "39.9",
      scope: "product",
      product: "1005006123456789",
      sale_id: SALE_ID,
      starts_at: "2026-11-11T00:00",
      ends_at: "",
      featured: true,
    });
    expect(parseCouponForm(values)).toEqual({
      ok: true,
      input: {
        ...VALID,
        min_spend_ils: 39.9,
        starts_at: "2026-11-10T22:00:00.000Z",
        ends_at: null,
      },
    });
  });

  it("starts a new coupon as a sitewide draft with empty fields", () => {
    expect(formValuesFromCoupon(null)).toMatchObject({
      scope: "sitewide",
      code: "",
      min_spend: "",
      featured: false,
    });
  });
});
