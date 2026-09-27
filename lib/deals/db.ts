// Deal queries against the `deals` table, taking the Supabase client as a parameter so tests can
// pass a fake. lib/deals/queries.ts binds them to the real clients: the anon key for public reads
// (RLS only lets anon see published rows) and the service role for admin writes.
// Date windows are applied in SQL and checked again in code on the rows that come back.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Deal, DealInput } from "@/lib/types";
import { PRODUCT_ID_PATTERN } from "./product-id";
import { DEAL_TYPES } from "./schema";
import { hasEnded, isCurrent } from "./time";

export type DealsClient = Pick<SupabaseClient, "from">;

export const DEALS_TABLE = "deals";
export const DEAL_COLUMNS =
  "id, type, title, body, product_id, coupon_code, starts_at, ends_at, published, created_at";
/** Enough for the public board; the admin list is not paged either. */
export const PUBLIC_LIMIT = 100;
export const ADMIN_LIMIT = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deal ids are uuids; anything else cannot exist, so it never reaches the database. */
export const isDealId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

/** The database failed. The message comes from PostgREST and holds no secrets. */
export class DealsDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealsDbError";
  }
}

export class DealNotFoundError extends Error {
  constructor(id: string) {
    super(`deal ${id} not found`);
    this.name = "DealNotFoundError";
  }
}

const timestamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

const dealRowSchema = z.object({
  id: z.string(),
  type: z.enum(DEAL_TYPES),
  title: z.string(),
  body: z
    .string()
    .nullable()
    .transform((b) => b ?? ""),
  product_id: z.string().nullable(),
  coupon_code: z.string().nullable(),
  starts_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  published: z.boolean(),
  created_at: timestamp,
});

/** A row as a Deal, or null when it does not have the expected shape (skipped, not a crash). */
export function toDeal(row: unknown): Deal | null {
  const parsed = dealRowSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

function toDeals(data: unknown): Deal[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const deal = toDeal(row);
    return deal ? [deal] : [];
  });
}

type DbResult = { data: unknown; error: { message: string } | null };

async function run(query: PromiseLike<DbResult>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw new DealsDbError(error.message);
  return data;
}

/** PostgREST filter: ends_at is empty or still ahead. Matches hasEnded(). */
const notEnded = (now: Date) => `ends_at.is.null,ends_at.gt.${now.toISOString()}`;

/** A big sale: a published holiday with a start (the countdowns count from it). */
const isSale = (d: Deal) => d.published && d.type === "holiday" && d.starts_at !== null;

/** How far ahead /sales looks: its calendar shows 12 months. */
export const SALES_HORIZON_DAYS = 365;

// Public reads.

export async function selectPublishedDeals(db: DealsClient, now: Date): Promise<Deal[]> {
  const data = await run(
    db
      .from(DEALS_TABLE)
      .select(DEAL_COLUMNS)
      .eq("published", true)
      .or(notEnded(now))
      .order("created_at", { ascending: false })
      .limit(PUBLIC_LIMIT),
  );
  return toDeals(data).filter((d) => d.published && !hasEnded(d, now));
}

/** Earliest-starting published holiday that has not ended; one already running counts. */
export async function selectNextSale(db: DealsClient, now: Date): Promise<Deal | null> {
  const data = await run(
    db
      .from(DEALS_TABLE)
      .select(DEAL_COLUMNS)
      .eq("published", true)
      .eq("type", "holiday")
      .not("starts_at", "is", null)
      .or(notEnded(now))
      .order("starts_at", { ascending: true })
      .limit(10),
  );
  return toDeals(data).find((d) => isSale(d) && !hasEnded(d, now)) ?? null;
}

/**
 * Published holidays for /sales, earliest start first: not ended, and starting within
 * `horizonDays` of now (or already running).
 */
export async function selectSalesCalendar(
  db: DealsClient,
  now: Date,
  horizonDays: number = SALES_HORIZON_DAYS,
): Promise<Deal[]> {
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const data = await run(
    db
      .from(DEALS_TABLE)
      .select(DEAL_COLUMNS)
      .eq("published", true)
      .eq("type", "holiday")
      .not("starts_at", "is", null)
      .lte("starts_at", horizon.toISOString())
      .or(notEnded(now))
      .order("starts_at", { ascending: true })
      .limit(PUBLIC_LIMIT),
  );
  return toDeals(data).filter(
    (d) => isSale(d) && !hasEnded(d, now) && Date.parse(d.starts_at as string) <= horizon.getTime(),
  );
}

/** One published holiday by id (the /sales calendar file), or null. Ended ones still count. */
export async function selectPublishedSale(db: DealsClient, id: string): Promise<Deal | null> {
  if (!isDealId(id)) return null;
  const data = await run(
    db
      .from(DEALS_TABLE)
      .select(DEAL_COLUMNS)
      .eq("id", id)
      .eq("published", true)
      .eq("type", "holiday")
      .maybeSingle(),
  );
  const deal = data ? toDeal(data) : null;
  return deal && deal.id === id && isSale(deal) ? deal : null;
}

/** Newest published deal for this product that is running now and has a coupon. */
export async function selectCouponForProduct(
  db: DealsClient,
  productId: string,
  now: Date,
): Promise<Deal | null> {
  if (!PRODUCT_ID_PATTERN.test(productId)) return null;
  const data = await run(
    db
      .from(DEALS_TABLE)
      .select(DEAL_COLUMNS)
      .eq("published", true)
      .eq("product_id", productId)
      .not("coupon_code", "is", null)
      .or(notEnded(now))
      .order("created_at", { ascending: false })
      .limit(20),
  );
  // Not-yet-started deals are filtered here rather than with a second or= filter.
  return (
    toDeals(data).find(
      (d) =>
        d.published && d.product_id === productId && !!d.coupon_code?.trim() && isCurrent(d, now),
    ) ?? null
  );
}

// Admin (service role; callers have passed requireAdmin()).

export async function selectAllDeals(db: DealsClient): Promise<Deal[]> {
  const data = await run(
    db
      .from(DEALS_TABLE)
      .select(DEAL_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(ADMIN_LIMIT),
  );
  return toDeals(data);
}

export async function selectDeal(db: DealsClient, id: string): Promise<Deal | null> {
  if (!isDealId(id)) return null;
  const data = await run(db.from(DEALS_TABLE).select(DEAL_COLUMNS).eq("id", id).maybeSingle());
  return data ? toDeal(data) : null;
}

function savedDeal(data: unknown, id?: string): Deal {
  const deal = data ? toDeal(data) : null;
  if (deal) return deal;
  if (id) throw new DealNotFoundError(id);
  throw new DealsDbError("insert returned no row");
}

/** `input` must already be validated (validateDealInput). */
export async function insertDeal(db: DealsClient, input: DealInput): Promise<Deal> {
  const data = await run(db.from(DEALS_TABLE).insert(input).select(DEAL_COLUMNS).single());
  return savedDeal(data);
}

/** `input` must already be validated. Leaves published and created_at alone. */
export async function updateDeal(db: DealsClient, id: string, input: DealInput): Promise<Deal> {
  if (!isDealId(id)) throw new DealNotFoundError(String(id));
  const data = await run(
    db.from(DEALS_TABLE).update(input).eq("id", id).select(DEAL_COLUMNS).maybeSingle(),
  );
  return savedDeal(data, id);
}

export async function updatePublished(
  db: DealsClient,
  id: string,
  published: boolean,
): Promise<void> {
  if (!isDealId(id)) throw new DealNotFoundError(String(id));
  const data = await run(db.from(DEALS_TABLE).update({ published }).eq("id", id).select("id"));
  if (!Array.isArray(data) || data.length === 0) throw new DealNotFoundError(id);
}

/** Deleting a deal that is already gone is not an error. */
export async function removeDeal(db: DealsClient, id: string): Promise<void> {
  if (!isDealId(id)) return;
  await run(db.from(DEALS_TABLE).delete().eq("id", id));
}
