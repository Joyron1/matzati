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
//
// A refetch (every 12 hours) whose type 2 call fails, or sends no usable link for a product, keeps
// the fresh type 2 link that product's stored row already holds (withStoredHotLinks) rather than
// going back to the list's own link: the product still pays the hot rate, and the stored link is
// still inside LINK_MAX_AGE_DAYS.
import { z } from "zod";
import {
  HOT_LINK_TYPE,
  MAX_LINKS_PER_CALL,
  itemSourceUrl,
  productIdOfSource,
} from "@/lib/aliexpress/affiliate";
import { affiliateUrl, type AliProduct, type AliPromotionLink } from "@/lib/aliexpress/schemas";
import { LINK_MAX_AGE_DAYS } from "@/lib/config/site";

/** A stored link older than this is not reused (/p and /go renew it then, lib/search/server.ts). */
export const LINK_MAX_AGE_MS = LINK_MAX_AGE_DAYS * 86_400_000;

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

/**
 * The ids of the products the type 2 call was for (hotLinkSources) that have no hot link yet: the
 * call failed, or it sent nothing usable for them.
 */
export function productsWithoutHotLink(products: AliProduct[]): string[] {
  const linked = new Set(
    products.filter((p) => p.promotionLinkType === HOT_LINK_TYPE).map((p) => p.productId),
  );
  return hotLinkSources(products)
    .map(productIdOfSource)
    .filter((id): id is string => id !== null && !linked.has(id));
}

/** A stored row's link fields (products.data, jsonb): read back, so not trusted. */
export interface StoredLinkRow {
  productId: string;
  promotionLink: unknown;
  promotionLinkType: unknown;
  promotionLinkAt: unknown;
}

const storedLinkRowSchema = z.object({
  product_id: z.string(),
  link: z.unknown(),
  type: z.unknown(),
  at: z.unknown(),
});

/**
 * The rows of `select("product_id, link:data->>promotionLink, type:data->promotionLinkType,
 * at:data->>promotionLinkAt")` on products. A row of another shape is left out.
 */
export function parseStoredLinkRows(data: unknown): StoredLinkRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = storedLinkRowSchema.safeParse(row);
    return r.success
      ? [
          {
            productId: r.data.product_id,
            promotionLink: r.data.link,
            promotionLinkType: r.data.type,
            promotionLinkAt: r.data.at,
          },
        ]
      : [];
  });
}

/**
 * The stored link of `row` when it is a type 2 hot link (exactly the number 2), an https
 * AliExpress link, and younger than LINK_MAX_AGE_MS at `now` (clock ms), with its time; otherwise
 * null. The age rule is the one /p and /go read (linkIsFresh in lib/search/server.ts).
 */
function freshHotLink(row: StoredLinkRow, now: number): { link: string; at: string } | null {
  if (row.promotionLinkType !== HOT_LINK_TYPE) return null;
  const link = affiliateUrl(row.promotionLink);
  if (!link || typeof row.promotionLinkAt !== "string") return null;
  const made = Date.parse(row.promotionLinkAt);
  if (!Number.isFinite(made) || now - made >= LINK_MAX_AGE_MS) return null;
  return { link, at: row.promotionLinkAt };
}

/**
 * `products` where each one the type 2 call was for but got no hot link from it
 * (productsWithoutHotLink) keeps the fresh hot link of its stored row (`stored`), with the time
 * that link was made, so /p and /go keep aging it from then. Every other product, and one whose
 * stored link is not a fresh type 2 link, comes back unchanged. A product whose hot rate is no
 * longer higher was not asked for, so it goes back to the list's link. Neither the set nor the
 * order changes.
 */
export function withStoredHotLinks(
  products: AliProduct[],
  stored: StoredLinkRow[],
  now: number,
): AliProduct[] {
  const missing = new Set(productsWithoutHotLink(products));
  const byId = new Map<string, { link: string; at: string }>();
  for (const row of stored) {
    const fresh = missing.has(row.productId) ? freshHotLink(row, now) : null;
    if (fresh && !byId.has(row.productId)) byId.set(row.productId, fresh);
  }
  return products.map((p) => {
    const kept = byId.get(p.productId);
    return kept
      ? {
          ...p,
          promotionLink: kept.link,
          promotionLinkType: HOT_LINK_TYPE,
          promotionLinkAt: kept.at,
        }
      : p;
  });
}
