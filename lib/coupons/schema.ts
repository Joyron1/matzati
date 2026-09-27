// Validation for owner coupons: the CouponInput contract (checked again right before every write)
// and the admin form on top of it (datetime-local in Israel time, product id or AliExpress URL,
// minimum spend in shekels). Pure and client-safe, with Hebrew messages the form shows next to
// each field. The same rules are in the coupons migration.
import { z } from "zod";
import { extractProductId, PRODUCT_ID_ERRORS, PRODUCT_ID_PATTERN } from "@/lib/deals/product-id";
import { israelLocalToIso, isoToIsraelLocal } from "@/lib/deals/time";
import type { Coupon, CouponInput, CouponScope } from "./types";

export const COUPON_SCOPES = ["sitewide", "product"] as const satisfies readonly CouponScope[];

export const CODE_MAX = 40;
export const CODE_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${CODE_MAX}}$`);
export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const TERMS_MAX = 1000;
/** Far above any real minimum; catches a typo like an extra zero or two. */
export const MIN_SPEND_MAX = 100_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Coupon and deal ids are uuids; anything else cannot exist, so it never reaches the database. */
export const isUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

export const COUPON_ERRORS = {
  code: `כתבו את קוד הקופון: אותיות באנגלית, ספרות, מקף וקו תחתון, עד ${CODE_MAX} תווים.`,
  title: `כתבו כותרת באורך ${TITLE_MIN} עד ${TITLE_MAX} תווים.`,
  terms: `התנאים ארוכים מדי. אפשר עד ${TERMS_MAX.toLocaleString("en-US")} תווים.`,
  minSpend: "כתבו סכום מינימום בשקלים, למשל 40 או 39.90, או השאירו ריק אם אין מינימום.",
  scope: "בחרו אם הקופון לכל האתר או למוצר אחד.",
  productRequired: "לקופון למוצר צריך מספר מוצר או קישור לדף המוצר באלי אקספרס.",
  productId: PRODUCT_ID_ERRORS.invalid,
  sitewideProduct: "קופון לכל האתר לא מקושר למוצר. בחרו ״למוצר אחד״ או מחקו את המוצר.",
  sale: "המבצע שבחרתם כבר לא קיים. בחרו מבצע אחר מהרשימה, או ״ללא מבצע״.",
  date: "התאריך או השעה לא תקינים. בחרו שוב מהלוח.",
  order: "מועד הסיום לא יכול להיות לפני מועד ההתחלה.",
} as const;

const instant = z.iso
  .datetime({ offset: true, error: COUPON_ERRORS.date })
  .transform((s) => new Date(s).toISOString());

const optionalText = (max: number, message: string) =>
  z
    .string(message)
    .trim()
    .max(max, message)
    .nullable()
    .transform((s) => (s ? s : null));

export const couponInputSchema = z
  .object({
    code: z.string(COUPON_ERRORS.code).trim().regex(CODE_PATTERN, COUPON_ERRORS.code),
    title: z
      .string(COUPON_ERRORS.title)
      .trim()
      .min(TITLE_MIN, COUPON_ERRORS.title)
      .max(TITLE_MAX, COUPON_ERRORS.title),
    terms: optionalText(TERMS_MAX, COUPON_ERRORS.terms),
    min_spend_ils: z
      .number(COUPON_ERRORS.minSpend)
      .min(0, COUPON_ERRORS.minSpend)
      .max(MIN_SPEND_MAX, COUPON_ERRORS.minSpend)
      // Whole agorot only; also rejects NaN and Infinity.
      .refine(hasAgorot, COUPON_ERRORS.minSpend)
      .nullable(),
    scope: z.enum(COUPON_SCOPES, COUPON_ERRORS.scope),
    product_id: z.string().trim().regex(PRODUCT_ID_PATTERN, COUPON_ERRORS.productId).nullable(),
    sale_id: z.string(COUPON_ERRORS.sale).refine(isUuid, COUPON_ERRORS.sale).nullable(),
    starts_at: instant.nullable(),
    ends_at: instant.nullable(),
    featured: z.boolean(),
  })
  .superRefine(
    (c, ctx) => {
      if (c.scope === "product" && !c.product_id) {
        ctx.addIssue({
          code: "custom",
          path: ["product_id"],
          message: COUPON_ERRORS.productRequired,
        });
      }
      if (c.scope === "sitewide" && c.product_id) {
        ctx.addIssue({
          code: "custom",
          path: ["product_id"],
          message: COUPON_ERRORS.sitewideProduct,
        });
      }
      if (c.starts_at && c.ends_at && Date.parse(c.ends_at) < Date.parse(c.starts_at)) {
        ctx.addIssue({ code: "custom", path: ["ends_at"], message: COUPON_ERRORS.order });
      }
    },
    {
      // Runs even when other fields failed, so the form shows every problem at once; skipped only
      // when a field these rules read is itself invalid.
      when: ({ value, issues }) =>
        typeof value === "object" &&
        value !== null &&
        !issues.some((i) =>
          ["scope", "product_id", "starts_at", "ends_at"].includes(String(i.path?.[0])),
        ),
    },
  );

/** True when `n` has at most two decimals (39.9, 39.90, 40), allowing for float noise. */
function hasAgorot(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

export type CouponField = keyof CouponInput;
/** First message per field; `form` is for problems that belong to no single field. */
export type CouponFieldErrors = Partial<Record<CouponField | "form", string>>;

export type CouponValidation =
  { ok: true; input: CouponInput } | { ok: false; errors: CouponFieldErrors };

function fieldErrors(error: z.ZodError): CouponFieldErrors {
  const errors: CouponFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    const field =
      typeof key === "string" && key in couponInputSchema.shape ? (key as CouponField) : "form";
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Validates and normalizes a CouponInput (trimmed text, empty terms as null, UTC ISO dates). */
export function validateCouponInput(input: unknown): CouponValidation {
  const parsed = couponInputSchema.safeParse(input);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, errors: fieldErrors(parsed.error) };
}

/** What the admin typed, echoed back so a rejected form keeps its values. */
export interface CouponFormValues {
  code: string;
  title: string;
  terms: string;
  /** Shekels as typed: "40", "39.90", "₪1,000". */
  min_spend: string;
  scope: string;
  /** Product id or pasted AliExpress URL; ignored for a sitewide coupon. */
  product: string;
  /** A holiday deal id, or "" for none. */
  sale_id: string;
  /** datetime-local values, Israel time. */
  starts_at: string;
  ends_at: string;
  featured: boolean;
}

/** useActionState state of the admin coupon form. */
export interface CouponFormState {
  values: CouponFormValues;
  errors: CouponFieldErrors;
}

export function formValuesFromCoupon(coupon: Coupon | null): CouponFormValues {
  return {
    code: coupon?.code ?? "",
    title: coupon?.title ?? "",
    terms: coupon?.terms ?? "",
    min_spend: coupon?.min_spend_ils == null ? "" : String(coupon.min_spend_ils),
    scope: coupon?.scope ?? "sitewide",
    product: coupon?.product_id ?? "",
    sale_id: coupon?.sale_id ?? "",
    starts_at: isoToIsraelLocal(coupon?.starts_at),
    ends_at: isoToIsraelLocal(coupon?.ends_at),
    featured: coupon?.featured ?? false,
  };
}

export function readCouponFormValues(formData: FormData): CouponFormValues {
  const text = (field: Exclude<keyof CouponFormValues, "featured">) => {
    const raw = formData.get(field);
    return typeof raw === "string" ? raw : "";
  };
  return {
    code: text("code"),
    title: text("title"),
    terms: text("terms"),
    min_spend: text("min_spend"),
    scope: text("scope"),
    product: text("product"),
    sale_id: text("sale_id"),
    starts_at: text("starts_at"),
    ends_at: text("ends_at"),
    featured: formData.get("featured") === "on",
  };
}

// "40", "39.9", "39.90" after "₪", spaces and thousands commas are removed.
const MIN_SPEND_INPUT = /^\d{1,6}(?:\.\d{1,2})?$/;

/** "₪1,000" → 1000; null when it is not an amount in shekels with up to two decimals. */
export function parseMinSpend(value: string): number | null {
  const cleaned = value.replace(/[₪\s,]/g, "");
  return MIN_SPEND_INPUT.test(cleaned) ? Number(cleaned) : null;
}

/**
 * Admin form → CouponInput. Empty optional fields become null, a pasted AliExpress link becomes
 * its product id (a sitewide coupon drops the product field), and datetime-local values are read
 * as Israel time.
 */
export function parseCouponForm(values: CouponFormValues): CouponValidation {
  const errors: CouponFieldErrors = {};
  const optional = (v: string) => (v.trim() === "" ? null : v.trim());

  let minSpend: number | null = null;
  const minSpendText = optional(values.min_spend);
  if (minSpendText) {
    minSpend = parseMinSpend(minSpendText);
    if (minSpend === null) errors.min_spend_ils = COUPON_ERRORS.minSpend;
  }

  let productId: string | null = null;
  if (values.scope === "product") {
    const product = optional(values.product);
    if (!product) errors.product_id = COUPON_ERRORS.productRequired;
    else {
      const extracted = extractProductId(product);
      if (extracted.ok) productId = extracted.id;
      else errors.product_id = PRODUCT_ID_ERRORS[extracted.error];
    }
  }

  const date = (field: "starts_at" | "ends_at") => {
    const local = optional(values[field]);
    if (!local) return null;
    const iso = israelLocalToIso(local);
    if (!iso) errors[field] = COUPON_ERRORS.date;
    return iso;
  };
  const startsAt = date("starts_at");
  const endsAt = date("ends_at");

  const result = validateCouponInput({
    code: values.code,
    title: values.title,
    terms: optional(values.terms),
    min_spend_ils: minSpend,
    scope: values.scope,
    product_id: productId,
    sale_id: optional(values.sale_id),
    starts_at: startsAt,
    ends_at: endsAt,
    featured: values.featured === true,
  });
  // Errors found while reading the form describe what the admin typed, so they win.
  if (!result.ok) return { ok: false, errors: { ...result.errors, ...errors } };
  return Object.keys(errors).length ? { ok: false, errors } : result;
}
