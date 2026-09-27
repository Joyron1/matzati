import { describe, expect, it } from "vitest";
import type { Deal, DealInput } from "@/lib/types";
import { PRODUCT_ID_ERRORS } from "./product-id";
import {
  DEAL_ERRORS,
  formValuesFromDeal,
  parseDealForm,
  readFormValues,
  validateDealInput,
  type DealFormValues,
} from "./schema";

const VALID: DealInput = {
  type: "deal",
  title: "הנחה על אוזניות ספורט",
  body: "96.8% משוב חיובי.",
  product_id: "1005006123456789",
  coupon_code: "IL_SALE-5",
  starts_at: "2026-10-01T00:00:00+03:00",
  ends_at: "2026-10-05T23:59:00+03:00",
};

const FORM: DealFormValues = {
  type: "holiday",
  title: "  מבצע 11.11  ",
  body: "",
  product: "",
  coupon_code: "",
  starts_at: "2026-11-11T00:00",
  ends_at: "2026-11-13T23:59",
  date_zone: "israel",
};

describe("validateDealInput", () => {
  it("accepts a valid deal, trimming text and normalizing dates to UTC", () => {
    const result = validateDealInput({ ...VALID, title: `  ${VALID.title} ` });
    expect(result).toEqual({
      ok: true,
      input: {
        ...VALID,
        starts_at: "2026-09-30T21:00:00.000Z",
        ends_at: "2026-10-05T20:59:00.000Z",
      },
    });
  });

  it("accepts the optional fields as null", () => {
    const input = { ...VALID, product_id: null, coupon_code: null, starts_at: null, ends_at: null };
    expect(validateDealInput(input)).toEqual({ ok: true, input });
  });

  it("checks the title length (3-120) and the body length (up to 1000)", () => {
    expect(validateDealInput({ ...VALID, title: " אב " })).toEqual({
      ok: false,
      errors: { title: DEAL_ERRORS.title },
    });
    expect(validateDealInput({ ...VALID, title: "א".repeat(121) })).toMatchObject({
      ok: false,
      errors: { title: DEAL_ERRORS.title },
    });
    expect(validateDealInput({ ...VALID, title: "א".repeat(120) }).ok).toBe(true);
    expect(validateDealInput({ ...VALID, body: "א".repeat(1000) }).ok).toBe(true);
    expect(validateDealInput({ ...VALID, body: "א".repeat(1001) })).toMatchObject({
      ok: false,
      errors: { body: DEAL_ERRORS.body },
    });
  });

  it("only allows known types", () => {
    expect(validateDealInput({ ...VALID, type: "coupon" })).toMatchObject({
      ok: false,
      errors: { type: DEAL_ERRORS.type },
    });
  });

  it("checks the product id and the coupon code format", () => {
    expect(validateDealInput({ ...VALID, product_id: "12a" })).toMatchObject({
      ok: false,
      errors: { product_id: DEAL_ERRORS.productId },
    });
    for (const code of ["SAVE 5", "קופון", "a".repeat(41), "", "50%"]) {
      expect(validateDealInput({ ...VALID, coupon_code: code }), code).toMatchObject({
        ok: false,
        errors: { coupon_code: DEAL_ERRORS.coupon },
      });
    }
    expect(validateDealInput({ ...VALID, coupon_code: "a".repeat(40) }).ok).toBe(true);
  });

  it("wants ISO dates with an offset, and an end that is not before the start", () => {
    expect(validateDealInput({ ...VALID, starts_at: "2026-10-01" })).toMatchObject({
      ok: false,
      errors: { starts_at: DEAL_ERRORS.date },
    });
    expect(validateDealInput({ ...VALID, ends_at: "2026-10-05T23:59:00" })).toMatchObject({
      ok: false,
      errors: { ends_at: DEAL_ERRORS.date },
    });
    expect(
      validateDealInput({ ...VALID, starts_at: VALID.ends_at, ends_at: VALID.starts_at }),
    ).toEqual({ ok: false, errors: { ends_at: DEAL_ERRORS.order } });
    expect(validateDealInput({ ...VALID, ends_at: VALID.starts_at }).ok).toBe(true);
  });

  it("requires a start for a holiday sale (the countdown counts to it)", () => {
    expect(validateDealInput({ ...VALID, type: "holiday", starts_at: null })).toEqual({
      ok: false,
      errors: { starts_at: DEAL_ERRORS.holidayStart },
    });
    expect(validateDealInput({ ...VALID, type: "holiday", ends_at: null }).ok).toBe(true);
  });

  it("rejects input that is not an object", () => {
    expect(validateDealInput(null).ok).toBe(false);
    expect(validateDealInput("deal").ok).toBe(false);
  });
});

describe("parseDealForm", () => {
  it("turns empty optional fields into null and reads dates as Israel time", () => {
    expect(parseDealForm(FORM)).toEqual({
      ok: true,
      input: {
        type: "holiday",
        title: "מבצע 11.11",
        body: "",
        product_id: null,
        coupon_code: null,
        starts_at: "2026-11-10T22:00:00.000Z",
        ends_at: "2026-11-13T21:59:00.000Z",
      },
    });
  });

  it("reads dates typed in Pacific time straight to an instant", () => {
    const pacific = { ...FORM, date_zone: "pacific" };
    expect(parseDealForm(pacific)).toMatchObject({
      ok: true,
      input: { starts_at: "2026-11-11T08:00:00.000Z", ends_at: "2026-11-14T07:59:00.000Z" },
    });
    // 16:30 Pacific on 24.10 is 01:30 on 25.10 in Israel, inside Israel's repeated fall-back
    // hour. Read directly it is 23:30Z; through Israel wall-clock time it would come out 22:30Z.
    expect(parseDealForm({ ...pacific, starts_at: "2026-10-24T16:30", ends_at: "" })).toMatchObject(
      { ok: true, input: { starts_at: "2026-10-24T23:30:00.000Z" } },
    );
    // Any other value is Israel time.
    expect(parseDealForm({ ...FORM, date_zone: "mars" })).toEqual(parseDealForm(FORM));
  });

  it("takes the product id from a pasted AliExpress link", () => {
    const result = parseDealForm({
      ...FORM,
      type: "deal",
      product: "https://he.aliexpress.com/item/1005006123456789.html?spm=x",
      coupon_code: " IL5 ",
    });
    expect(result).toMatchObject({
      ok: true,
      input: { product_id: "1005006123456789", coupon_code: "IL5" },
    });
  });

  it("explains what is wrong with the product field", () => {
    expect(parseDealForm({ ...FORM, product: "https://a.aliexpress.com/_mK1" })).toEqual({
      ok: false,
      errors: { product_id: PRODUCT_ID_ERRORS.short_link },
    });
    expect(parseDealForm({ ...FORM, product: "https://example.com/p/1" })).toEqual({
      ok: false,
      errors: { product_id: PRODUCT_ID_ERRORS.not_aliexpress },
    });
  });

  it("reports a bad date on its own field, ahead of rules that depend on it", () => {
    expect(parseDealForm({ ...FORM, starts_at: "2026-02-30T10:00" })).toEqual({
      ok: false,
      errors: { starts_at: DEAL_ERRORS.date },
    });
  });

  it("collects errors from every field at once", () => {
    const result = parseDealForm({
      ...FORM,
      title: "א",
      product: "abc def",
      starts_at: "2026-11-13T00:00",
      ends_at: "2026-11-11T00:00",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        title: DEAL_ERRORS.title,
        product_id: PRODUCT_ID_ERRORS.invalid,
        ends_at: DEAL_ERRORS.order,
      },
    });
  });
});

describe("form values", () => {
  it("reads every field from FormData, missing ones as empty", () => {
    const data = new FormData();
    data.set("type", "deal");
    data.set("title", "כותרת");
    data.set("$ACTION_ID_abc", "");
    expect(readFormValues(data)).toEqual({
      type: "deal",
      title: "כותרת",
      body: "",
      product: "",
      coupon_code: "",
      starts_at: "",
      ends_at: "",
      date_zone: "",
    });
  });

  it("fills the edit form from a saved deal, in Israel time", () => {
    const deal: Deal = {
      ...VALID,
      id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      starts_at: "2026-09-30T21:00:00.000Z",
      ends_at: null,
      published: true,
      created_at: "2026-09-27T10:00:00.000Z",
    };
    const values = formValuesFromDeal(deal);
    expect(values).toEqual({
      type: "deal",
      title: VALID.title,
      body: VALID.body,
      product: "1005006123456789",
      coupon_code: "IL_SALE-5",
      starts_at: "2026-10-01T00:00",
      ends_at: "",
      date_zone: "israel",
    });
    expect(parseDealForm(values)).toEqual({
      ok: true,
      input: { ...VALID, starts_at: "2026-09-30T21:00:00.000Z", ends_at: null },
    });
  });

  it("starts a new deal as type deal with empty fields", () => {
    expect(formValuesFromDeal(null)).toMatchObject({ type: "deal", title: "", starts_at: "" });
  });
});
