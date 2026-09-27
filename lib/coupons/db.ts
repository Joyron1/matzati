// Coupon queries against the `coupons` table, taking the Supabase client as a parameter so tests
// can pass a fake. lib/coupons/queries.ts binds them to the real clients: the anon key for public
// reads (RLS only lets anon see published rows) and the service role for admin writes.
// Date windows are applied in SQL where they can be, and every public read checks published and
// the window again in code on the rows that come back.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hasEnded, hasStarted, isCurrent } from "@/lib/deals/time";
import { PRODUCT_ID_PATTERN } from "@/lib/deals/product-id";
import { COUPON_SCOPES, isUuid } from "./schema";
import type { Coupon, CouponInput, PublicCoupons } from "./types";

export type CouponsClient = Pick<SupabaseClient, "from">;

export const COUPONS_TABLE = "coupons";
export const COUPON_COLUMNS =
  "id, code, title, terms, min_spend_ils, scope, product_id, sale_id, starts_at, ends_at, featured, published, created_at, updated_at";
/** Every published coupon that has not ended; far more than the owner will run at once. */
export const PUBLIC_LIMIT = 200;
/** Per product page or sale card. */
export const ROW_LIMIT = 20;
export const ADMIN_LIMIT = 500;

/** Coupon ids are uuids; anything else cannot exist, so it never reaches the database. */
export const isCouponId = isUuid;

/** The database failed. The message comes from PostgREST and holds no secrets. */
export class CouponsDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouponsDbError";
  }
}

export class CouponNotFoundError extends Error {
  constructor(id: string) {
    super(`coupon ${id} not found`);
    this.name = "CouponNotFoundError";
  }
}

/** sale_id names a deal that no longer exists (foreign key violation). */
export class CouponSaleMissingError extends Error {
  constructor() {
    super("linked sale not found");
    this.name = "CouponSaleMissingError";
  }
}

const timestamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

// PostgREST sends numeric as a JSON number; a string is accepted too, in case that ever changes.
const amount = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n >= 0);

const couponRowSchema = z.object({
  id: z.string(),
  code: z.string().min(1),
  title: z.string().min(1),
  terms: z
    .string()
    .nullable()
    .transform((s) => (s?.trim() ? s : null)),
  min_spend_ils: amount.nullable(),
  scope: z.enum(COUPON_SCOPES),
  product_id: z.string().nullable(),
  sale_id: z.string().nullable(),
  starts_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  featured: z.boolean(),
  published: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});

/** A row as a Coupon, or null when it does not have the expected shape (skipped, not a crash). */
export function toCoupon(row: unknown): Coupon | null {
  const parsed = couponRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const c = parsed.data;
  // A product coupon without its product (or the reverse) could not link anywhere sensible.
  if ((c.scope === "product") !== (c.product_id !== null)) return null;
  return c;
}

function toCoupons(data: unknown): Coupon[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const coupon = toCoupon(row);
    return coupon ? [coupon] : [];
  });
}

type DbError = { message: string; code?: string };
type DbResult = { data: unknown; error: DbError | null };

const FOREIGN_KEY_VIOLATION = "23503";

async function run(query: PromiseLike<DbResult>): Promise<unknown> {
  const { data, error } = await query;
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) throw new CouponSaleMissingError();
    throw new CouponsDbError(error.message);
  }
  return data;
}

/** PostgREST filter: ends_at is empty or still ahead. Matches hasEnded(). */
const notEnded = (now: Date) => `ends_at.is.null,ends_at.gt.${now.toISOString()}`;

// Ordering (pure).

const time = (iso: string | null, fallback: number) => (iso === null ? fallback : Date.parse(iso));

/** Featured first, then the soonest to end (no end date last), then the newest. */
export function byActiveOrder(a: Coupon, b: Coupon): number {
  return (
    Number(b.featured) - Number(a.featured) ||
    time(a.ends_at, Infinity) - time(b.ends_at, Infinity) ||
    Date.parse(b.created_at) - Date.parse(a.created_at)
  );
}

/** The soonest to start first, then the soonest to end. */
export function byStartOrder(a: Coupon, b: Coupon): number {
  return (
    time(a.starts_at, -Infinity) - time(b.starts_at, -Infinity) ||
    time(a.ends_at, Infinity) - time(b.ends_at, Infinity) ||
    Date.parse(b.created_at) - Date.parse(a.created_at)
  );
}

// Selection (pure): what each public page shows out of the rows the database returned.

/** /coupons: published coupons that are valid now, and those that start later. */
export function splitPublicCoupons(coupons: Coupon[], now: Date): PublicCoupons {
  const live = coupons.filter((c) => c.published && !hasEnded(c, now));
  return {
    active: live.filter((c) => hasStarted(c, now)).sort(byActiveOrder),
    upcoming: live.filter((c) => !hasStarted(c, now)).sort(byStartOrder),
  };
}

/** A product page: this product's current coupons first, then current featured sitewide ones. */
export function pickProductCoupons(coupons: Coupon[], productId: string, now: Date): Coupon[] {
  const current = coupons.filter((c) => c.published && isCurrent(c, now));
  const own = current.filter((c) => c.scope === "product" && c.product_id === productId);
  const sitewide = current.filter((c) => c.scope === "sitewide" && c.featured);
  const unique = new Map(
    [...own.sort(byActiveOrder), ...sitewide.sort(byActiveOrder)].map((c) => [c.id, c]),
  );
  return [...unique.values()];
}

/** A sale card: the sale's coupons that are valid now, then those that start later. */
export function pickSaleCoupons(coupons: Coupon[], saleId: string, now: Date): Coupon[] {
  const { active, upcoming } = splitPublicCoupons(
    coupons.filter((c) => c.sale_id === saleId),
    now,
  );
  return [...active, ...upcoming];
}

// Public reads (anon client).

/** Published coupons that have not ended, soonest to end first (no end date last). */
export async function selectPublishedCoupons(db: CouponsClient, now: Date): Promise<Coupon[]> {
  const data = await run(
    db
      .from(COUPONS_TABLE)
      .select(COUPON_COLUMNS)
      .eq("published", true)
      .or(notEnded(now))
      .order("ends_at", { ascending: true, nullsFirst: false })
      .limit(PUBLIC_LIMIT),
  );
  return toCoupons(data).filter((c) => c.published && !hasEnded(c, now));
}

export async function selectPublicCoupons(db: CouponsClient, now: Date): Promise<PublicCoupons> {
  return splitPublicCoupons(await selectPublishedCoupons(db, now), now);
}

/**
 * Coupons for a product page, valid now: the product's own, then featured sitewide ones. Two small
 * queries rather than one with two or= filters. No query for an id that cannot exist.
 */
export async function selectCouponsForProduct(
  db: CouponsClient,
  productId: string,
  now: Date,
): Promise<Coupon[]> {
  if (!PRODUCT_ID_PATTERN.test(productId)) return [];
  const [own, sitewide] = await Promise.all([
    run(
      db
        .from(COUPONS_TABLE)
        .select(COUPON_COLUMNS)
        .eq("published", true)
        .eq("scope", "product")
        .eq("product_id", productId)
        .or(notEnded(now))
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
    ),
    run(
      db
        .from(COUPONS_TABLE)
        .select(COUPON_COLUMNS)
        .eq("published", true)
        .eq("scope", "sitewide")
        .eq("featured", true)
        .or(notEnded(now))
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
    ),
  ]);
  // Not-yet-started coupons are filtered here rather than with a second or= filter.
  return pickProductCoupons([...toCoupons(own), ...toCoupons(sitewide)], productId, now);
}

/** A sale's published coupons that have not ended: current first, then upcoming. */
export async function selectCouponsForSale(
  db: CouponsClient,
  saleId: string,
  now: Date,
): Promise<Coupon[]> {
  if (!isUuid(saleId)) return [];
  const data = await run(
    db
      .from(COUPONS_TABLE)
      .select(COUPON_COLUMNS)
      .eq("published", true)
      .eq("sale_id", saleId)
      .or(notEnded(now))
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT),
  );
  return pickSaleCoupons(toCoupons(data), saleId, now);
}

// Admin (service role; callers have passed requireAdmin()).

export async function selectAllCoupons(db: CouponsClient): Promise<Coupon[]> {
  const data = await run(
    db
      .from(COUPONS_TABLE)
      .select(COUPON_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(ADMIN_LIMIT),
  );
  return toCoupons(data);
}

export async function selectCoupon(db: CouponsClient, id: string): Promise<Coupon | null> {
  if (!isCouponId(id)) return null;
  const data = await run(db.from(COUPONS_TABLE).select(COUPON_COLUMNS).eq("id", id).maybeSingle());
  return data ? toCoupon(data) : null;
}

function savedCoupon(data: unknown, id?: string): Coupon {
  const coupon = data ? toCoupon(data) : null;
  if (coupon) return coupon;
  if (id) throw new CouponNotFoundError(id);
  throw new CouponsDbError("insert returned no row");
}

/** `input` must already be validated (validateCouponInput). New coupons start as drafts. */
export async function insertCoupon(db: CouponsClient, input: CouponInput): Promise<Coupon> {
  const data = await run(db.from(COUPONS_TABLE).insert(input).select(COUPON_COLUMNS).single());
  return savedCoupon(data);
}

/** `input` must already be validated. Leaves published and created_at alone. */
export async function updateCoupon(
  db: CouponsClient,
  id: string,
  input: CouponInput,
): Promise<Coupon> {
  if (!isCouponId(id)) throw new CouponNotFoundError(String(id));
  const data = await run(
    db.from(COUPONS_TABLE).update(input).eq("id", id).select(COUPON_COLUMNS).maybeSingle(),
  );
  return savedCoupon(data, id);
}

export async function updateCouponPublished(
  db: CouponsClient,
  id: string,
  published: boolean,
): Promise<void> {
  if (!isCouponId(id)) throw new CouponNotFoundError(String(id));
  const data = await run(db.from(COUPONS_TABLE).update({ published }).eq("id", id).select("id"));
  if (!Array.isArray(data) || data.length === 0) throw new CouponNotFoundError(id);
}

/** Deleting a coupon that is already gone is not an error. */
export async function removeCoupon(db: CouponsClient, id: string): Promise<void> {
  if (!isCouponId(id)) return;
  await run(db.from(COUPONS_TABLE).delete().eq("id", id));
}
