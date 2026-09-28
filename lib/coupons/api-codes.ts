// AliExpress promo codes on products we have checked, for the /coupons section "קודים של אלי
// אקספרס למוצרים שבדקנו". AliExpress data: `products.data.promoCode` is the AliPromoCode the
// product refresh stored (lib/aliexpress/promo-code.ts). The same rules as on /p (apiCouponFor in
// lib/search/server.ts): ILS products only, since the amounts are in the request currency, and
// only while valid by the code's own dates (isPromoCodeCurrent). On top of that, only rows
// refreshed in the last 48 hours, so a code AliExpress has since dropped does not linger here.
// Service role: the products table has no public policy.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import {
  isPromoCodeCurrent,
  readStoredPromoCode,
  type AliPromoCode,
} from "@/lib/aliexpress/promo-code";
import { hasHebrew, hotTitle } from "@/lib/product-title";
import { serviceClient } from "@/lib/supabase/server";
import { fixTransliterations } from "@/lib/transliterations";

export type ProductsClient = Pick<SupabaseClient, "from">;

/** Newest rows with a code to look at; far more than AliExpress attaches codes to. */
export const API_CODES_LIMIT = 200;
/** A code is shown only from a product row refreshed this recently. */
export const API_CODES_MAX_AGE_HOURS = 48;
export const API_CODES_COLUMNS =
  "product_id, title_he, updated_at, title:data->>title, image:data->>mainImageUrl, currency:data->>currency, promo:data->promoCode";

export interface ApiCodeProduct {
  productId: string;
  /**
   * Hebrew title when a search wrote one, else the AliExpress title: English, or AliExpress's
   * Hebrew machine translation for a product saved from a hot list (lib/product-title.ts).
   */
  title: string;
  /** Read from the letters: a hot product's AliExpress title is Hebrew too. */
  titleIsHebrew: boolean;
  /** The title is AliExpress's Hebrew machine translation, not one of ours. */
  machineTranslated: boolean;
  /** products.data.mainImageUrl; null when missing. */
  imageUrl: string | null;
  /** When the product (and so the code) was last checked at AliExpress: products.updated_at. */
  checkedAt: string;
  promoCode: AliPromoCode;
}

/** The database failed. The message comes from PostgREST and holds no secrets. */
export class ApiCodesDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiCodesDbError";
  }
}

const timestamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((v) => (v ?? null) as z.output<T> | null);

const rowSchema = z.object({
  product_id: z.string().regex(/^\d{1,20}$/),
  title_he: nullable(z.string()),
  updated_at: timestamp,
  title: nullable(z.string()),
  image: nullable(z.string()),
  currency: nullable(z.string()),
  promo: z.unknown(),
});

const cutoff = (now: Date) =>
  new Date(now.getTime() - API_CODES_MAX_AGE_HOURS * 3_600_000).toISOString();

/** A row as an ApiCodeProduct, or null when it is malformed, stale, not in ILS or not current. */
export function toApiCodeProduct(row: unknown, now: Date): ApiCodeProduct | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (r.updated_at < cutoff(now) || r.currency !== "ILS") return null;
  // The stored shape is re-checked (storedPromoCodeSchema), as on /p.
  const promo = readStoredPromoCode(r.promo);
  if (!promo || !isPromoCodeCurrent(promo, now)) return null;
  // Our Hebrew title, with the known transliterations fixed (lib/transliterations); else
  // AliExpress's, its Hebrew machine translation read the same way (hotTitle).
  const titleHe = r.title_he?.trim() ? fixTransliterations(r.title_he.trim(), r.title) : null;
  const original = r.title?.trim();
  const machineTranslated = titleHe === null && !!original && hasHebrew(original);
  const title = titleHe ?? (original && machineTranslated ? hotTitle(original) : original);
  if (!title) return null;
  return {
    productId: r.product_id,
    title,
    titleIsHebrew: hasHebrew(title),
    machineTranslated,
    imageUrl: r.image?.trim() || null,
    checkedAt: r.updated_at,
    promoCode: promo,
  };
}

/** Current codes, the soonest to end first. */
export function toApiCodeProducts(data: unknown, now: Date): ApiCodeProduct[] {
  if (!Array.isArray(data)) return [];
  const byId = new Map<string, ApiCodeProduct>();
  for (const row of data) {
    const item = toApiCodeProduct(row, now);
    if (item && !byId.has(item.productId)) byId.set(item.productId, item);
  }
  // Current codes always have an end date (isPromoCodeCurrent).
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.promoCode.endsAt ?? "") - Date.parse(b.promoCode.endsAt ?? "") ||
      Date.parse(b.checkedAt) - Date.parse(a.checkedAt),
  );
}

/**
 * Rows refreshed in the last 48 hours whose data has a promoCode, newest first. The code's own
 * dates are checked in code (toApiCodeProducts): they are ISO strings inside jsonb.
 */
export async function selectApiCodes(db: ProductsClient, now: Date): Promise<ApiCodeProduct[]> {
  const { data, error } = await db
    .from("products")
    .select(API_CODES_COLUMNS)
    .not("data->>promoCode", "is", null)
    .gte("updated_at", cutoff(now))
    .order("updated_at", { ascending: false })
    .limit(API_CODES_LIMIT);
  if (error) throw new ApiCodesDbError(error.message);
  return toApiCodeProducts(data, now);
}

// Cached rows; the time rules are applied again with the time of each visit. The version part
// changes with the cached shape (2: titleIsHebrew read from the letters, machineTranslated).
const cachedApiCodes = unstable_cache(
  async () => selectApiCodes(serviceClient(), new Date()),
  ["api-promo-codes", "2"],
  { revalidate: 300 },
);

/**
 * Stored ILS products whose AliExpress promo code is valid at `now`, the soonest to end first.
 * Cached for 5 minutes. Throws when the database fails (the section shows an error line).
 */
export async function listApiCodes(now: Date): Promise<ApiCodeProduct[]> {
  const cached = await cachedApiCodes();
  return cached.filter(
    (item) => isPromoCodeCurrent(item.promoCode, now) && item.checkedAt >= cutoff(now),
  );
}
