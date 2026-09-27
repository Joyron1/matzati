// A product coupon links to /p/<id>, and /p only serves products we have saved. Saving a coupon
// for a product we have not seen imports it the way the deal form does (lib/deals/import-product):
// one productdetail.get, a link.generate only when the product has no affiliate link, then save.
// Nothing is called for a product that is already stored.
// The deps mirror productImportDeps() in app/admin/deals/actions.ts, which cannot be imported
// from a "use server" file without becoming an action itself.
import "server-only";
import { generateLinks, getProductDetails } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import {
  ensureDealProduct,
  PRODUCT_IMPORT_ERRORS,
  type ProductImportDeps,
} from "@/lib/deals/import-product";
import { aliexpressConfig } from "@/lib/env";
import { SupabaseStore } from "@/lib/search/supabase-store";
import { serviceClient } from "@/lib/supabase/server";
import type { CouponFieldErrors } from "./schema";

function productImportDeps(): ProductImportDeps {
  const store = new SupabaseStore(serviceClient());
  let client: AliExpressClient | undefined;
  const ali = () => (client ??= new AliExpressClient(aliexpressConfig()));
  return {
    isStored: async (id) => (await store.getProduct(id)) !== null,
    fetchDetails: async (id) => {
      const page = await getProductDetails(ali(), [id]);
      return page.products.find((p) => p.productId === id) ?? null;
    },
    generateLink: async (id) => {
      const links = await generateLinks(ali(), [`https://www.aliexpress.com/item/${id}.html`]);
      return links.find((l) => l.promotionLink)?.promotionLink ?? null;
    },
    // No Hebrew title: /p shows the AliExpress title until a search writes one.
    save: (product) => store.saveProducts([product], {}),
  };
}

/**
 * Makes sure /p/<id> will work for a product coupon. Null when it will; Hebrew errors for the
 * form otherwise. Callers have passed requireAdmin().
 */
export async function importCouponProduct(productId: string): Promise<CouponFieldErrors | null> {
  try {
    const result = await ensureDealProduct(productId, productImportDeps());
    if (result.ok) return null;
    return result.error === "not_saved"
      ? { form: PRODUCT_IMPORT_ERRORS.not_saved }
      : { product_id: PRODUCT_IMPORT_ERRORS[result.error] };
  } catch (err) {
    if (err instanceof AliExpressError && err.kind === "invalid_request") {
      return { product_id: PRODUCT_IMPORT_ERRORS.not_found };
    }
    // Name and message only. Our errors name missing env keys, never their values.
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-coupons] product: ${text.slice(0, 300)}`);
    return { form: PRODUCT_IMPORT_ERRORS.unavailable };
  }
}
