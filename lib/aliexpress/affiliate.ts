// Typed affiliate API calls. Behavior verified with real calls on 2026-09-26
// (scripts/check-aliexpress.ts, scripts/probe-aliexpress.ts; details in docs/aliexpress-api.md):
// - target_currency=ILS works for product.query and productdetail.get, so prices come from
//   AliExpress in shekels (the same figure the buyer sees) and we don't convert them ourselves
// - min_sale_price/max_sale_price are minor units of target_currency: ₪100 → 10000
// - target_language=HE returns machine-translated Hebrew titles. We search in EN so the §6.5
//   must_have check runs on the original English title; the LLM writes title_he (§6.8)
// - default ordering is poor for keyword searches; LAST_VOLUME_DESC surfaces established products
// - hotproduct.query works since the owner activated the Advanced API group (probed 2026-09-28,
//   scripts/probe-hot.ts): the same 33 product fields, ILS accepted although undocumented
// - product.sku.detail.get returns InsufficientPermission (2026-09-28): getSkuDetails stays behind
//   SKU_DETAILS_ENABLED
import type { AliExpressClient, ParamValue } from "./client";
import { AliExpressError } from "./errors";
import {
  parseCategories,
  parseProductPage,
  parsePromotionLinks,
  parseSkuDetails,
  type AliCategory,
  type AliPromotionLink,
  type AliSkuDetails,
  type ProductPage,
} from "./schemas";

export const CURRENCY = "ILS";
export const SHIP_TO = "IL";
export const MAX_PAGE_SIZE = 50;
export const MAX_LINKS_PER_CALL = 50;

export type Language = "EN" | "HE";
export type ProductSort =
  "SALE_PRICE_ASC" | "SALE_PRICE_DESC" | "LAST_VOLUME_ASC" | "LAST_VOLUME_DESC";

/** ₪ → agorot, the unit min_sale_price/max_sale_price expect when target_currency=ILS. */
export function toMinorUnits(amount: number | undefined): number | undefined {
  if (amount === undefined || !Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100);
}

export interface ProductQuery {
  keywords: string;
  pageNo?: number;
  pageSize?: number;
  sort?: ProductSort;
  minPriceIls?: number;
  maxPriceIls?: number;
  language?: Language;
}

/** Exact params the search pipeline sends; shared with the check script so fixtures match. */
export function productQueryParams(
  q: ProductQuery,
  trackingId: string,
): Record<string, ParamValue> {
  return {
    keywords: q.keywords,
    page_no: q.pageNo ?? 1,
    page_size: Math.min(q.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE),
    sort: q.sort ?? "LAST_VOLUME_DESC",
    min_sale_price: toMinorUnits(q.minPriceIls),
    max_sale_price: toMinorUnits(q.maxPriceIls),
    target_currency: CURRENCY,
    target_language: q.language ?? "EN",
    ship_to_country: SHIP_TO,
    tracking_id: trackingId,
  };
}

const EMPTY_PAGE: ProductPage = { products: [], skipped: 0, totalRecords: 0 };

async function productCall(
  client: AliExpressClient,
  method: string,
  params: Record<string, ParamValue>,
): Promise<ProductPage> {
  try {
    const res = await client.call(method, params);
    return parseProductPage(res.result);
  } catch (err) {
    if (err instanceof AliExpressError && err.kind === "no_results") return { ...EMPTY_PAGE };
    throw err;
  }
}

export function queryProducts(client: AliExpressClient, q: ProductQuery): Promise<ProductPage> {
  return productCall(
    client,
    "aliexpress.affiliate.product.query",
    productQueryParams(q, client.trackingId),
  );
}

export interface HotProductQuery {
  /** One first-level category id; omitted, the whole hot list (mostly phone cases, per the probe). */
  categoryId?: string;
  pageNo?: number;
  pageSize?: number;
  sort?: ProductSort;
  language?: Language;
}

/**
 * Params of hotproduct.query (doc 700) as probed on 2026-09-28. HE by default: the hot list is
 * shown as AliExpress sends it (machine-translated titles), with no must_have check to run. No
 * keywords or price bounds: /hot filters the fetched list itself.
 */
export function hotProductQueryParams(
  q: HotProductQuery,
  trackingId: string,
): Record<string, ParamValue> {
  return {
    category_ids: q.categoryId,
    page_no: q.pageNo ?? 1,
    page_size: Math.min(q.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE),
    sort: q.sort ?? "LAST_VOLUME_DESC",
    target_currency: CURRENCY,
    target_language: q.language ?? "HE",
    ship_to_country: SHIP_TO,
    tracking_id: trackingId,
  };
}

/**
 * AliExpress's hot products for affiliates (products with a hot-product commission). A page of 50
 * brings 45 to 47 products, sorted by 30-day sales in bands rather than strictly, and two calls
 * seconds apart share few ids: treat one call as the list (docs/aliexpress-api.md, Hot products).
 */
export function queryHotProducts(
  client: AliExpressClient,
  q: HotProductQuery = {},
): Promise<ProductPage> {
  return productCall(
    client,
    "aliexpress.affiliate.hotproduct.query",
    hotProductQueryParams(q, client.trackingId),
  );
}

export function getProductDetails(
  client: AliExpressClient,
  productIds: string[],
  language: Language = "EN",
): Promise<ProductPage> {
  if (!productIds.length) return Promise.resolve({ ...EMPTY_PAGE });
  return productCall(client, "aliexpress.affiliate.productdetail.get", {
    product_ids: productIds.join(","),
    target_currency: CURRENCY,
    target_language: language,
    country: SHIP_TO,
    tracking_id: client.trackingId,
  });
}

export async function getCategories(client: AliExpressClient): Promise<AliCategory[]> {
  const res = await client.call("aliexpress.affiliate.category.get");
  return parseCategories(res.result);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Colors, sizes, prices and delivery days per SKU (product.sku.detail.get, doc 1795). Only called
 * while SKU_DETAILS_ENABLED is on: this app has no permission for the method yet. need_deliver_info
 * asks for the delivery-day fields (slower, per the docs). No tracking_id: the per-SKU links it
 * returns are never used, buying always goes through /go. Null when there are no SKUs.
 */
export async function getSkuDetails(
  client: AliExpressClient,
  productId: string,
): Promise<AliSkuDetails | null> {
  try {
    const res = await client.call("aliexpress.affiliate.product.sku.detail.get", {
      product_id: productId,
      ship_to_country: SHIP_TO,
      target_currency: CURRENCY,
      target_language: "HE",
      need_deliver_info: "Yes",
    });
    return parseSkuDetails(res.result, productId);
  } catch (err) {
    if (err instanceof AliExpressError && err.kind === "no_results") return null;
    throw err;
  }
}

/** Affiliate links for product URLs that came without promotion_link. Batches of 50. */
export async function generateLinks(
  client: AliExpressClient,
  sourceUrls: string[],
): Promise<AliPromotionLink[]> {
  const links: AliPromotionLink[] = [];
  for (const batch of chunk([...new Set(sourceUrls)], MAX_LINKS_PER_CALL)) {
    const res = await client.call("aliexpress.affiliate.link.generate", {
      promotion_link_type: 0,
      source_values: batch.join(","),
      tracking_id: client.trackingId,
    });
    links.push(...parsePromotionLinks(res.result));
  }
  return links;
}
