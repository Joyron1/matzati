// Which hot products get a link.generate hot link (promotion_link_type 2), and how the answer is
// mapped back onto them. Pure.
//
// Owner decision 2026-09-28: a hot product we show whose hot_product_commission_rate is above its
// commission_rate gets a type 2 link, "hot link which has hot product commission" per doc 921
// (the hot rate was higher on 177 of 184 probed products, median 8% vs 7%). Every other product
// keeps the promotion_link hotproduct.query sent (its type is unknown). This decides the link only:
// which products are shown, and in what order, is settled before (select.ts) and never looks at
// either rate. Whether AliExpress credits the hot rate for these links is UNCONFIRMED until orders
// show it (docs/aliexpress-api.md, Hot link).
import {
  HOT_LINK_TYPE,
  MAX_LINKS_PER_CALL,
  itemSourceUrl,
  productIdOfSource,
} from "@/lib/aliexpress/affiliate";
import { affiliateUrl, type AliProduct, type AliPromotionLink } from "@/lib/aliexpress/schemas";

/** True when AliExpress offers this product a hot rate above its standard rate. */
export function paysHotRate(
  p: Pick<AliProduct, "commissionRatePct" | "hotCommissionRatePct">,
): boolean {
  const hot = p.hotCommissionRatePct ?? null;
  return hot !== null && p.commissionRatePct !== null && hot > p.commissionRatePct;
}

/**
 * The source values of the one link.generate call for `products`: those that pay a hot rate, at
 * most MAX_LINKS_PER_CALL (a hot list has at most 50 products anyway).
 */
export function hotLinkSources(products: AliProduct[]): string[] {
  const ids = [...new Set(products.filter(paysHotRate).map((p) => p.productId))];
  return ids.slice(0, MAX_LINKS_PER_CALL).map(itemSourceUrl);
}

/**
 * `products` with the hot links of `links` (a link.generate type 2 answer for hotLinkSources) in
 * place of their own, marked promotionLinkType 2 and made at `madeAt` (ISO). A link counts only for
 * a product we asked for, matched by the product id in its source value, and only when it is an
 * https AliExpress link. Any other product comes back unchanged, with the list's own link.
 */
export function withHotLinks(
  products: AliProduct[],
  links: AliPromotionLink[],
  madeAt: string,
): AliProduct[] {
  const asked = new Set(hotLinkSources(products).map(productIdOfSource));
  const byId = new Map<string, string>();
  for (const l of links) {
    const id = productIdOfSource(l.sourceValue);
    const url = affiliateUrl(l.promotionLink);
    if (id && url && asked.has(id) && !byId.has(id)) byId.set(id, url);
  }
  return products.map((p) => {
    const link = byId.get(p.productId);
    return link
      ? { ...p, promotionLink: link, promotionLinkType: HOT_LINK_TYPE, promotionLinkAt: madeAt }
      : p;
  });
}
