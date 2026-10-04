// Reads for public pages and writes for the admin (service role, after requireAdmin()).
// Public reads use the anon key on purpose: RLS ("anon may only select published deals") then
// guards them too, so a bug in a filter here can never leak a draft. The query builders live in
// lib/deals/db.ts and are tested with a fake client.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { serviceClient } from "@/lib/supabase/server";
import type { Deal, DealInput } from "@/lib/types";
import {
  insertDeal,
  removeDeal,
  selectAllDeals,
  selectCouponForProduct,
  selectDeal,
  selectNextSale,
  selectPublishedDeals,
  selectPublishedSale,
  selectSalesCalendar,
  updateDeal,
  updatePublished,
} from "./db";
import type { BarSale } from "./sale-bar";
import { validateDealInput, type FieldErrors } from "./schema";

export { DealNotFoundError, DealsDbError, isDealId } from "./db";

/** saveDeal was given input that fails validation. `errors` are Hebrew, per field. */
export class DealValidationError extends Error {
  constructor(readonly errors: FieldErrors) {
    super(`invalid deal input: ${Object.keys(errors).join(", ")}`);
    this.name = "DealValidationError";
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

/** Published deals for /deals, newest first; expired ones (ends_at in the past) are left out. */
export async function listPublishedDeals(now: Date): Promise<Deal[]> {
  return selectPublishedDeals(publicClient(), now);
}

/** The next published 'holiday' deal that has not ended, for the home countdown. Null if none. */
export async function nextSale(now: Date): Promise<Deal | null> {
  return selectNextSale(publicClient(), now);
}

/**
 * Published holidays for /sales: not ended, starting within 12 months or already running,
 * earliest start first.
 */
export async function salesCalendar(now: Date): Promise<Deal[]> {
  return selectSalesCalendar(publicClient(), now);
}

/** One published holiday by id, for its calendar file. Null if none (ids are checked first). */
export async function publishedSale(id: string): Promise<Deal | null> {
  return selectPublishedSale(publicClient(), id);
}

/** A published, current deal with a coupon for this product (shown on /p). Null if none. */
export async function couponForProduct(productId: string, now: Date): Promise<Deal | null> {
  return selectCouponForProduct(publicClient(), productId, now);
}

// Admin (callers must have passed requireAdmin()).
export async function listAllDeals(): Promise<Deal[]> {
  return selectAllDeals(serviceClient());
}
export async function getDeal(id: string): Promise<Deal | null> {
  return selectDeal(serviceClient(), id);
}
/** Creates when id is undefined, updates otherwise. Returns the saved deal. */
export async function saveDeal(input: DealInput, id?: string): Promise<Deal> {
  // Validated again here: this is the last stop before the service-role write.
  const checked = validateDealInput(input);
  if (!checked.ok) throw new DealValidationError(checked.errors);
  const db = serviceClient();
  return id === undefined ? insertDeal(db, checked.input) : updateDeal(db, id, checked.input);
}
export async function setDealPublished(id: string, published: boolean): Promise<void> {
  return updatePublished(serviceClient(), id, published);
}
export async function deleteDeal(id: string): Promise<void> {
  return removeDeal(serviceClient(), id);
}

/** Cache tag for everything derived from published deals; admin actions call updateTag(DEALS_TAG). */
export const DEALS_TAG = "deals";

/**
 * Whether /deals has anything to show, for the menu and footer links: an empty deals page is not
 * linked. Cached for 5 minutes and refreshed at once when an admin changes a deal. Failures read
 * as "no deals" so a database hiccup never breaks the header.
 */
export const hasPublishedDeals = unstable_cache(
  async () => {
    try {
      return (await listPublishedDeals(new Date())).length > 0;
    } catch {
      return false;
    }
  },
  ["has-published-deals"],
  { revalidate: 300, tags: [DEALS_TAG] },
);

/**
 * The sales the top bar may show (components/sale-bar.tsx): /sales' list, cut to what the bar
 * needs, and when it was read (the bar's clock until the browser takes over). Cached like
 * hasPublishedDeals; failures read as no sales, so the bar never breaks a page.
 */
export const saleBarSales = unstable_cache(
  async (): Promise<{ checkedAt: number; sales: BarSale[] }> => {
    const now = new Date();
    try {
      const sales = (await salesCalendar(now))
        .slice(0, 5)
        .flatMap((d) =>
          d.starts_at === null
            ? []
            : [{ id: d.id, title: d.title, starts_at: d.starts_at, ends_at: d.ends_at }],
        );
      return { checkedAt: now.getTime(), sales };
    } catch {
      return { checkedAt: now.getTime(), sales: [] };
    }
  },
  ["sale-bar-sales"],
  { revalidate: 300, tags: [DEALS_TAG] },
);

/**
 * Whether /sales has an upcoming or running sale, for the menu, footer and sitemap links. Cached
 * like hasPublishedDeals; failures read as "no sales".
 */
export const hasUpcomingSales = unstable_cache(
  async () => {
    try {
      return (await salesCalendar(new Date())).length > 0;
    } catch {
      return false;
    }
  },
  ["has-upcoming-sales"],
  { revalidate: 300, tags: [DEALS_TAG] },
);
