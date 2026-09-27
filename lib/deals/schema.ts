// Validation for deals: the DealInput contract (checked again right before every write) and the
// admin form on top of it (datetime-local in Israel or Pacific time, product id or AliExpress URL).
// Pure, with Hebrew messages the form shows next to each field.
import { z } from "zod";
import type { Deal, DealInput, DealType } from "@/lib/types";
import { extractProductId, PRODUCT_ID_ERRORS, PRODUCT_ID_PATTERN } from "./product-id";
import { ISRAEL_TIME_ZONE, isoToIsraelLocal, PACIFIC_TIME_ZONE, zonedLocalToIso } from "./time";

export const DEAL_TYPES = ["deal", "holiday", "dont_buy"] as const satisfies readonly DealType[];

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BODY_MAX = 1000;
export const COUPON_MAX = 40;
const COUPON_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${COUPON_MAX}}$`);

export const DEAL_ERRORS = {
  type: "בחרו אחד מהסוגים: דיל, חג או מבצע, לא לקנות.",
  title: `כתבו כותרת באורך ${TITLE_MIN} עד ${TITLE_MAX} תווים.`,
  body: `התיאור ארוך מדי. אפשר עד ${BODY_MAX.toLocaleString("en-US")} תווים.`,
  productId: PRODUCT_ID_ERRORS.invalid,
  coupon: `קוד קופון יכול להכיל אותיות באנגלית, ספרות, מקף וקו תחתון, עד ${COUPON_MAX} תווים.`,
  date: "התאריך או השעה לא תקינים. בחרו שוב מהלוח.",
  order: "מועד הסיום לא יכול להיות לפני מועד ההתחלה.",
  holidayStart: "למבצע צריך מועד התחלה, כדי שנוכל להציג ספירה לאחור.",
} as const;

const instant = z.iso
  .datetime({ offset: true, error: DEAL_ERRORS.date })
  .transform((s) => new Date(s).toISOString());

export const dealInputSchema = z
  .object({
    type: z.enum(DEAL_TYPES, DEAL_ERRORS.type),
    title: z
      .string(DEAL_ERRORS.title)
      .trim()
      .min(TITLE_MIN, DEAL_ERRORS.title)
      .max(TITLE_MAX, DEAL_ERRORS.title),
    body: z.string(DEAL_ERRORS.body).trim().max(BODY_MAX, DEAL_ERRORS.body),
    product_id: z.string().trim().regex(PRODUCT_ID_PATTERN, DEAL_ERRORS.productId).nullable(),
    coupon_code: z.string().trim().regex(COUPON_PATTERN, DEAL_ERRORS.coupon).nullable(),
    starts_at: instant.nullable(),
    ends_at: instant.nullable(),
  })
  .superRefine(
    (d, ctx) => {
      if (d.starts_at && d.ends_at && Date.parse(d.ends_at) < Date.parse(d.starts_at)) {
        ctx.addIssue({ code: "custom", path: ["ends_at"], message: DEAL_ERRORS.order });
      }
      // The home countdown and the holiday card both count from starts_at.
      if (d.type === "holiday" && !d.starts_at) {
        ctx.addIssue({ code: "custom", path: ["starts_at"], message: DEAL_ERRORS.holidayStart });
      }
    },
    {
      // Runs even when other fields failed, so the form shows every problem at once; skipped only
      // when a field these rules read is itself invalid.
      when: ({ value, issues }) =>
        typeof value === "object" &&
        value !== null &&
        !issues.some((i) => ["type", "starts_at", "ends_at"].includes(String(i.path?.[0]))),
    },
  );

export type DealField = keyof DealInput;
/** First message per field; `form` is for problems that belong to no single field. */
export type FieldErrors = Partial<Record<DealField | "form", string>>;

export type DealValidation = { ok: true; input: DealInput } | { ok: false; errors: FieldErrors };

function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    const field =
      typeof key === "string" && key in dealInputSchema.shape ? (key as DealField) : "form";
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Validates and normalizes a DealInput (trimmed text, dates as UTC ISO strings). */
export function validateDealInput(input: unknown): DealValidation {
  const parsed = dealInputSchema.safeParse(input);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, errors: fieldErrors(parsed.error) };
}

/** The clock the admin types the dates in: Israel time, or Pacific time as AliExpress announces. */
export type DateZone = "israel" | "pacific";

/** What the admin typed, echoed back so a rejected form keeps its values. */
export interface DealFormValues {
  type: string;
  title: string;
  body: string;
  /** Product id or pasted AliExpress URL. */
  product: string;
  coupon_code: string;
  /** datetime-local values, in the zone of `date_zone`. */
  starts_at: string;
  ends_at: string;
  /** A DateZone: "pacific" for Pacific time; anything else reads as Israel time. */
  date_zone: string;
}

/** useActionState state of the admin deal form. */
export interface DealFormState {
  values: DealFormValues;
  errors: FieldErrors;
}

export const FORM_FIELDS = [
  "type",
  "title",
  "body",
  "product",
  "coupon_code",
  "starts_at",
  "ends_at",
  "date_zone",
] as const satisfies readonly (keyof DealFormValues)[];

export function formValuesFromDeal(deal: Deal | null): DealFormValues {
  return {
    type: deal?.type ?? "deal",
    title: deal?.title ?? "",
    body: deal?.body ?? "",
    product: deal?.product_id ?? "",
    coupon_code: deal?.coupon_code ?? "",
    starts_at: isoToIsraelLocal(deal?.starts_at),
    ends_at: isoToIsraelLocal(deal?.ends_at),
    date_zone: "israel" satisfies DateZone,
  };
}

/** The IANA zone the form's dates were typed in. */
export function formTimeZone(values: Pick<DealFormValues, "date_zone">): string {
  return values.date_zone === "pacific" ? PACIFIC_TIME_ZONE : ISRAEL_TIME_ZONE;
}

export function readFormValues(formData: FormData): DealFormValues {
  const values = {} as DealFormValues;
  for (const field of FORM_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw : "";
  }
  return values;
}

/**
 * Admin form → DealInput. Empty optional fields become null, a pasted AliExpress link becomes its
 * product id, and datetime-local values are read in the zone they were typed in (date_zone), so a
 * Pacific time is converted once, straight to an instant. (Going through Israel wall-clock time
 * would lose an hour in Israel's repeated fall-back hour.)
 */
export function parseDealForm(values: DealFormValues): DealValidation {
  const errors: FieldErrors = {};
  const optional = (v: string) => (v.trim() === "" ? null : v.trim());

  let productId: string | null = null;
  const product = optional(values.product);
  if (product) {
    const extracted = extractProductId(product);
    if (extracted.ok) productId = extracted.id;
    else errors.product_id = PRODUCT_ID_ERRORS[extracted.error];
  }

  const timeZone = formTimeZone(values);
  const date = (field: "starts_at" | "ends_at") => {
    const local = optional(values[field]);
    if (!local) return null;
    const iso = zonedLocalToIso(local, timeZone);
    if (!iso) errors[field] = DEAL_ERRORS.date;
    return iso;
  };
  const startsAt = date("starts_at");
  const endsAt = date("ends_at");

  const result = validateDealInput({
    type: values.type,
    title: values.title,
    body: values.body,
    product_id: productId,
    coupon_code: optional(values.coupon_code),
    starts_at: startsAt,
    ends_at: endsAt,
  });
  // Errors found while reading the form describe what the admin typed, so they win.
  if (!result.ok) return { ok: false, errors: { ...result.errors, ...errors } };
  return Object.keys(errors).length ? { ok: false, errors } : result;
}
