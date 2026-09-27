// Reads for public pages and writes for the admin (service role, after requireAdmin()).
// Public reads use the anon key on purpose: RLS ("anon may only select published coupons") then
// guards them too, so a bug in a filter here can never leak a draft. The query builders live in
// lib/coupons/db.ts and are tested with a fake client.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { serviceClient } from "@/lib/supabase/server";
import { listApiCodes } from "./api-codes";
import {
  insertCoupon,
  removeCoupon,
  selectAllCoupons,
  selectCoupon,
  selectCouponsForProduct,
  selectCouponsForSale,
  selectPublishedCoupons,
  splitPublicCoupons,
  updateCoupon,
  updateCouponPublished,
} from "./db";
import { validateCouponInput, type CouponFieldErrors } from "./schema";
import { COUPONS_TAG, type Coupon, type CouponInput, type PublicCoupons } from "./types";

export type { PublicCoupons } from "./types";
export { CouponNotFoundError, CouponSaleMissingError, CouponsDbError, isCouponId } from "./db";

/** saveCoupon was given input that fails validation. `errors` are Hebrew, per field. */
export class CouponValidationError extends Error {
  constructor(readonly errors: CouponFieldErrors) {
    super(`invalid coupon input: ${Object.keys(errors).join(", ")}`);
    this.name = "CouponValidationError";
  }
}

let anonClient: SupabaseClient | undefined;

/** Anon-key client for public reads: RLS applies, no session is stored or refreshed. */
function publicClient(): SupabaseClient {
  if (anonClient) return anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  anonClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return anonClient;
}

function logError(where: string, err: unknown) {
  // Name and message only: no stack traces, and our errors never carry secret values.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[coupons] ${where}: ${text.slice(0, 300)}`);
}

// Public reads.

// Published rows that had not ended when cached; each caller filters again with its own time.
// Errors are thrown inside, so a failure is never cached.
const cachedPublished = unstable_cache(
  async (): Promise<Coupon[]> => selectPublishedCoupons(publicClient(), new Date()),
  ["published-coupons"],
  { revalidate: 300, tags: [COUPONS_TAG] },
);

/**
 * Published coupons for /coupons: valid now (featured first, then the soonest to end) and
 * starting later (soonest first). Cached for 5 minutes and refreshed at once when an admin
 * changes a coupon. Throws on a database failure (the page shows an error card).
 */
export async function listPublicCoupons(now: Date): Promise<PublicCoupons> {
  return splitPublicCoupons(await cachedPublished(), now);
}

/**
 * Coupons to show on a product page, valid now: that product's own coupons first, then featured
 * sitewide ones. [] on any failure (logged).
 */
export async function couponsForProduct(productId: string, now: Date): Promise<Coupon[]> {
  try {
    return await selectCouponsForProduct(publicClient(), productId, now);
  } catch (err) {
    logError("product", err);
    return [];
  }
}

/**
 * Published coupons linked to a sale (deals row of type "holiday") that have not ended: valid now
 * first, then those that start later. [] on any failure (logged).
 */
export async function couponsForSale(saleId: string, now: Date): Promise<Coupon[]> {
  try {
    return await selectCouponsForSale(publicClient(), saleId, now);
  } catch (err) {
    logError("sale", err);
    return [];
  }
}

/**
 * True when /coupons has something to show: an owner coupon that is valid now or starts later,
 * or an AliExpress code on a product we checked. For the menu and footer links: an empty coupons
 * page is not linked. Cached for 5 minutes and refreshed at once when an admin changes a coupon.
 * Failures read as "nothing" so a database hiccup never breaks the header.
 */
export const hasPublishedCoupons = unstable_cache(
  async (): Promise<boolean> => {
    const now = new Date();
    try {
      const { active, upcoming } = await listPublicCoupons(now);
      if (active.length > 0 || upcoming.length > 0) return true;
    } catch (err) {
      logError("has-coupons", err);
    }
    try {
      return (await listApiCodes(now)).length > 0;
    } catch (err) {
      logError("has-api-codes", err);
      return false;
    }
  },
  ["has-published-coupons"],
  { revalidate: 300, tags: [COUPONS_TAG] },
);

// Admin (callers must have passed requireAdmin()).

export async function listAllCoupons(): Promise<Coupon[]> {
  return selectAllCoupons(serviceClient());
}

export async function getCoupon(id: string): Promise<Coupon | null> {
  return selectCoupon(serviceClient(), id);
}

/** Creates when id is undefined (as a draft), updates otherwise. Returns the saved coupon. */
export async function saveCoupon(input: CouponInput, id?: string): Promise<Coupon> {
  // Validated again here: this is the last stop before the service-role write.
  const checked = validateCouponInput(input);
  if (!checked.ok) throw new CouponValidationError(checked.errors);
  const db = serviceClient();
  return id === undefined ? insertCoupon(db, checked.input) : updateCoupon(db, id, checked.input);
}

export async function setCouponPublished(id: string, published: boolean): Promise<void> {
  return updateCouponPublished(serviceClient(), id, published);
}

export async function deleteCoupon(id: string): Promise<void> {
  return removeCoupon(serviceClient(), id);
}
