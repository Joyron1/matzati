// An AliExpress promo code attached to a product (`promo_code_info` in product.query,
// productdetail.get and featuredpromo.products.get). AliExpress data, sparse: most products have
// none. Times arrive in Pacific time and are stored as ISO UTC. Shown only while valid.
//
// Reading rules (docs/aliexpress-api.md; real sample AJO7RM0ITRX2, 2026-09-28):
// - the offer comes from code_value through strict patterns only. code_campaigntype is never read:
//   the sample said "1" (documented as % off) for a fixed-amount code
// - code_quantity is never read, so it can never be shown
// - code_promotionurl carries no tracking id, so it is never used as a buy link
// - the validity window is read conservatively (see PROMO_START_TIME_ZONE)
import { z } from "zod";
import { zonedLocalToIso } from "@/lib/deals/time";

export type AliPromoOffer =
  /** "On order over ILS 62.2 , get ILS 3.11 off" */
  | { kind: "amount"; off: number; minSpend: number; currency: string }
  /** "n% off", optionally over a minimum */
  | { kind: "percent"; pct: number; minSpend: number | null; currency: string | null };

export interface AliPromoCode {
  code: string;
  /** code_value exactly as AliExpress wrote it (English); null when missing. */
  offerText: string | null;
  /** Parsed from offerText by a strict pattern; null when it does not match (show the text only). */
  offer: AliPromoOffer | null;
  /** code_mini_spend, in the currency of the request; null when missing. */
  minSpend: number | null;
  /**
   * ISO UTC, converted from code_availabletime_start (as fixed UTC-8) and code_availabletime_end
   * (as America/Los_Angeles): the later start and the earlier end of the two readings.
   */
  startsAt: string | null;
  endsAt: string | null;
  /** code_promotionurl when it is an https AliExpress URL; null otherwise. */
  promotionUrl: string | null;
}

/**
 * The docs give promo code times in "PST" and do not say whether AliExpress moves them to PDT in
 * summer. Until one real code settles it, the window is read on the safe side: the start as fixed
 * UTC-8 ("Etc/GMT+8": IANA's sign is inverted), which is the later reading in the PDT season, and
 * the end in America/Los_Angeles, the earlier one. A code is then never shown an hour before it
 * works or an hour after it stops; in winter both readings agree.
 */
export const PROMO_START_TIME_ZONE = "Etc/GMT+8";
/** See PROMO_START_TIME_ZONE. */
export const PROMO_TIME_ZONE = "America/Los_Angeles";

// Lenient on purpose: every field is optional and numbers are accepted as text, so an odd value
// drops that field instead of the whole code.
const text = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined ? null : String(v).trim() || null));

const rawPromoCodeSchema = z.object({
  promo_code: text,
  code_value: text,
  code_mini_spend: text,
  code_availabletime_start: text,
  code_availabletime_end: text,
  code_promotionurl: text,
});

/** What shoppers type at checkout. Anything else is not shown. */
const CODE = /^[A-Za-z0-9_-]{3,40}$/;

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const OVER = String.raw`On order over ([A-Z]{3}) ${NUM}\s*,\s*get`;
const AMOUNT_OVER = new RegExp(String.raw`^${OVER} \1 ${NUM} off$`);
const PERCENT_OVER = new RegExp(String.raw`^${OVER} ${NUM}% off$`);
const PERCENT = new RegExp(String.raw`^${NUM}% off$`);

function amount(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const validPct = (pct: number) => pct > 0 && pct < 100;

/**
 * The offer in code_value, or null when the text matches none of the known forms or the numbers
 * make no sense (nothing off, a discount at least as big as the minimum order, 100% or more).
 */
export function parseOffer(value: string | null): AliPromoOffer | null {
  const s = value?.trim().replace(/\s+/g, " ") ?? "";
  let m = AMOUNT_OVER.exec(s);
  if (m) {
    const [minSpend, off] = [Number(m[2]), Number(m[3])];
    return off > 0 && off < minSpend ? { kind: "amount", off, minSpend, currency: m[1] } : null;
  }
  m = PERCENT_OVER.exec(s);
  if (m) {
    const [minSpend, pct] = [Number(m[2]), Number(m[3])];
    return minSpend > 0 && validPct(pct)
      ? { kind: "percent", pct, minSpend, currency: m[1] }
      : null;
  }
  m = PERCENT.exec(s);
  if (m) {
    const pct = Number(m[1]);
    return validPct(pct) ? { kind: "percent", pct, minSpend: null, currency: null } : null;
  }
  return null;
}

function aliExpressUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const ok =
      url.protocol === "https:" &&
      (url.hostname === "aliexpress.com" || url.hostname.endsWith(".aliexpress.com"));
    return ok ? url.href : null;
  } catch {
    return null;
  }
}

const zoned = (value: string | null, timeZone: string) =>
  value ? zonedLocalToIso(value, timeZone) : null;

/** `promo_code_info` → AliPromoCode, or null when it is missing, malformed or has no usable code. */
export function parsePromoCode(value: unknown): AliPromoCode | null {
  const parsed = rawPromoCodeSchema.safeParse(value);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!r.promo_code || !CODE.test(r.promo_code)) return null;
  return {
    code: r.promo_code,
    offerText: r.code_value,
    offer: parseOffer(r.code_value),
    minSpend: amount(r.code_mini_spend),
    startsAt: zoned(r.code_availabletime_start, PROMO_START_TIME_ZONE),
    endsAt: zoned(r.code_availabletime_end, PROMO_TIME_ZONE),
    promotionUrl: aliExpressUrl(r.code_promotionurl),
  };
}

const timestamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((v) => (v ?? null) as z.output<T> | null);

const storedOfferSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("amount"),
    off: z.number().positive(),
    minSpend: z.number().nonnegative(),
    currency: z.string().min(1),
  }),
  z.object({
    kind: z.literal("percent"),
    pct: z.number().positive().max(100),
    minSpend: nullable(z.number().nonnegative()),
    currency: nullable(z.string().min(1)),
  }),
]);

/**
 * A stored AliPromoCode (products.data.promoCode) read back from the database. The jsonb is
 * checked again with the rules parsePromoCode applied, since the row may predate a parser change;
 * /p and /coupons both read stored codes through it. Anything that fails is not shown.
 */
export const storedPromoCodeSchema = z.object({
  code: z.string().regex(CODE),
  offerText: nullable(z.string().trim().min(1).max(300)),
  // An offer we cannot read is dropped; offerText still says what AliExpress wrote.
  offer: storedOfferSchema
    .nullish()
    .catch(null)
    .transform((o) => o ?? null),
  minSpend: nullable(z.number().nonnegative()),
  startsAt: nullable(timestamp),
  endsAt: nullable(timestamp),
  promotionUrl: z
    .string()
    .nullish()
    .catch(null)
    .transform((v) => aliExpressUrl(v ?? null)),
});

/** A stored promo code as an AliPromoCode, or null when it is missing or fails the checks. */
export function readStoredPromoCode(value: unknown): AliPromoCode | null {
  const parsed = storedPromoCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Valid at `now`: startsAt <= now < endsAt. A code whose start or end we could not read is never
 * shown, since the page cannot say until when it works.
 */
export function isPromoCodeCurrent(
  code: Pick<AliPromoCode, "startsAt" | "endsAt">,
  now: Date,
): boolean {
  if (!code.startsAt || !code.endsAt) return false;
  const t = now.getTime();
  return Date.parse(code.startsAt) <= t && t < Date.parse(code.endsAt);
}
