// Typed affiliate API calls. Behavior verified with real calls on 2026-09-26
// (scripts/check-aliexpress.ts, scripts/probe-aliexpress.ts; details in docs/aliexpress-api.md):
// - target_currency=ILS works for product.query and productdetail.get, so prices come from
//   AliExpress in shekels (the same figure the buyer sees) and we don't convert them ourselves
// - min_sale_price/max_sale_price are minor units of target_currency: ₪100 → 10000
// - target_language=HE returns machine-translated Hebrew titles. We search in EN so the §6.5
//   must_have check runs on the original English title; the LLM writes title_he (§6.8)
// - default ordering is poor for keyword searches; LAST_VOLUME_DESC surfaces established products
// - hotproduct.query returns InsufficientPermission for this app (needs approval in the AE console)
import type { AliExpressClient, ParamValue } from "./client";
import { AliExpressError } from "./errors";
import {
  parseCategories,
  parseProductPage,
  parsePromotionLinks,
  type AliCategory,
  type AliPromotionLink,
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
