// zod schemas for AliExpress affiliate responses, built from the saved fixtures in
// fixtures/aliexpress/ (captured 2026-09-26). Field notes from those real responses:
// - ids arrive as strings (the client quotes them to keep 17-digit sku_ids exact)
// - prices are decimal strings in major units; target_* fields carry the requested currency,
//   while sale_price/original_price stay in the store's currency (CNY or USD), so we ignore them
// - evaluate_rate ("97.2%") can be "" or missing; discount looks like "50%"
// - lists are wrapped: products.product[], categories.category[], product_small_image_urls.string[]
// - no store/seller rating field exists in any affiliate method
// - product_video_url is an .mp4 on video.aliexpress-media.com or "" (probe of 2026-09-28);
//   promo_code_info is present on a few products only (see promo-code.ts)
// - hot_product_commission_rate is "0.0%" on product.query and productdetail.get products and a real
//   rate on hotproduct.query products (3.5% to 15% in the probe of 2026-09-28)
import { z } from "zod";
import { parsePromoCode, type AliPromoCode } from "./promo-code";
import { unwrapList } from "./unwrap";

/** "97.2%" → 97.2; "", "-", missing → null */
export function parsePercent(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number.parseFloat(String(value).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

/** A rate above zero: "8.0%" → 8; "0.0%", "", missing → null */
export function positivePercent(value: unknown): number | null {
  const n = parsePercent(value);
  return n !== null && n > 0 ? n : null;
}

/** "183.70" → 183.7; "", missing → null */
export function parseAmount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const id = z.union([z.string(), z.number()]).transform(String);
const optionalText = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() !== "" ? s : null));

const MEDIA_HOST_SUFFIX = ".aliexpress-media.com";

/** An https URL on AliExpress's media CDN (videos, SKU photos), serialized; null otherwise. */
export function mediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.endsWith(MEDIA_HOST_SUFFIX) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * An https URL on aliexpress.com or one of its subdomains (affiliate links such as
 * s.click.aliexpress.com), serialized; null otherwise. The check every link we store or redirect
 * to passes, so a bad row or response can never make /go an open redirect. The serialized form
 * matters too: a raw value with a newline or a non-Latin-1 character would pass the host check
 * and then make a Location header throw.
 */
export function affiliateUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    const ok =
      url.protocol === "https:" &&
      (url.hostname === "aliexpress.com" || url.hostname.endsWith(".aliexpress.com"));
    return ok ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * link.generate's promotion_link_type (doc 921): 0 "normal link which has standard commission", 2
 * "hot link which has hot product commission". Whether AliExpress credits the hot rate for a type 2
 * link is UNCONFIRMED until orders show it (docs/aliexpress-api.md, Hot link).
 */
export type PromotionLinkType = 0 | 2;

export const rawProductSchema = z.object({
  product_id: id,
  product_title: z.string().min(1),
  target_sale_price: z.union([z.string(), z.number()]),
  target_sale_price_currency: z.string(),
  target_original_price: z.union([z.string(), z.number()]).optional(),
  target_original_price_currency: z.string().optional(),
  discount: z.string().optional(),
  evaluate_rate: z.string().optional(),
  lastest_volume: z.number().int().nonnegative().optional(),
  product_main_image_url: z.string().url(),
  product_small_image_urls: z.unknown().optional(),
  product_detail_url: z.string().url(),
  promotion_link: optionalText,
  shop_id: id.optional(),
  shop_name: optionalText,
  shop_url: optionalText,
  commission_rate: z.string().optional(),
  hot_product_commission_rate: z.string().optional(),
  first_level_category_id: id.optional(),
  first_level_category_name: optionalText,
  second_level_category_id: id.optional(),
  second_level_category_name: optionalText,
  // Read leniently below: a bad video or promo code drops that field, never the product.
  product_video_url: z.unknown().optional(),
  promo_code_info: z.unknown().optional(),
});

export interface AliProduct {
  productId: string;
  title: string;
  price: number;
  originalPrice: number | null;
  currency: string;
  discountPct: number | null;
  /** Product positive-feedback %, from evaluate_rate. Null when AliExpress sent none. */
  positiveFeedbackPct: number | null;
  /** lastest_volume: sales volume in the last 30 days per the AE docs (not lifetime). Null when missing. */
  unitsSold: number | null;
  mainImageUrl: string;
  imageUrls: string[];
  detailUrl: string;
  promotionLink: string | null;
  shop: { id: string | null; name: string | null; url: string | null };
  /** Used only to break exact ranking ties (CLAUDE.md §6.6). */
  commissionRatePct: number | null;
  /**
   * hot_product_commission_rate: the rate AliExpress offers for a hot link (type 2) to a hot
   * product. Null when it is "0.0%" (every product.query and productdetail.get product) or missing.
   * Stored for stats, and read only to choose which link type a hot product gets
   * (lib/hot/links.ts): it never influences selection, filtering or order, and never breaks a tie.
   * Optional: products saved before 2026-09-28 lack it.
   */
  hotCommissionRatePct?: number | null;
  category: {
    firstId: string | null;
    firstName: string | null;
    secondId: string | null;
    secondName: string | null;
  };
  // Optional from here on: products saved before 2026-09-28 lack these fields, so read them as
  // `?? null`. A fresh parse always sets videoUrl and promoCode.
  /** product_video_url when it is an https URL on *.aliexpress-media.com; null otherwise. */
  videoUrl?: string | null;
  /** promo_code_info (see promo-code.ts); null when absent or unusable. */
  promoCode?: AliPromoCode | null;
  /**
   * When promotionLink was made (ISO), where that differs from the stored row's updated_at: /go
   * sets it when it regenerates an old link, and the /p refresh keeps it when it reuses the stored
   * link. Absent when the link came with the product data of the row's last save.
   */
  promotionLinkAt?: string | null;
  /**
   * 2 when promotionLink is a link.generate hot link (promotion_link_type 2), made for a hot product
   * whose hot rate beat its standard rate (lib/hot/loader.ts); promotionLinkAt is then when it was
   * made. The /p refresh keeps such a link and /go regenerates it with type 2. Absent when the type
   * is unknown (links that came with product data) or 0. Never set by a parse.
   */
  promotionLinkType?: PromotionLinkType;
  /** product.sku.detail.get, fetched with the /p refresh while SKU_DETAILS_ENABLED is on. */
  skuDetails?: AliSkuDetails | null;
  /**
   * "hot" for a row saved from a hot list (lib/hot/loader.ts): its title is AliExpress's Hebrew
   * machine translation and its link came with that list. Absent for product.query and
   * productdetail.get data in English. Never set by a parse.
   */
  source?: "hot";
}

export const productSchema = rawProductSchema.transform((p, ctx): AliProduct => {
  const price = parseAmount(p.target_sale_price);
  if (price === null) {
    ctx.addIssue({ code: "custom", message: "target_sale_price is not a number" });
    return z.NEVER;
  }
  const original = parseAmount(p.target_original_price);
  const images = unwrapList(p.product_small_image_urls, "string").filter(
    (u): u is string => typeof u === "string" && u.startsWith("http"),
  );
  return {
    productId: p.product_id,
    title: p.product_title,
    price,
    originalPrice: original !== null && original > price ? original : null,
    currency: p.target_sale_price_currency,
    discountPct: parsePercent(p.discount),
    positiveFeedbackPct: parsePercent(p.evaluate_rate),
    unitsSold: p.lastest_volume ?? null,
    mainImageUrl: p.product_main_image_url,
    imageUrls: [...new Set([p.product_main_image_url, ...images])],
    detailUrl: p.product_detail_url,
    promotionLink: p.promotion_link,
    shop: { id: p.shop_id ?? null, name: p.shop_name, url: p.shop_url },
    commissionRatePct: parsePercent(p.commission_rate),
    hotCommissionRatePct: positivePercent(p.hot_product_commission_rate),
    category: {
      firstId: p.first_level_category_id ?? null,
      firstName: p.first_level_category_name,
      secondId: p.second_level_category_id ?? null,
      secondName: p.second_level_category_name,
    },
    videoUrl: mediaUrl(p.product_video_url),
    promoCode: parsePromoCode(p.promo_code_info),
  };
});

export interface ProductPage {
  products: AliProduct[];
  /** Items AliExpress returned that failed validation and were dropped. */
  skipped: number;
  totalRecords: number | null;
}

/** Parses products one by one so a single malformed item doesn't sink the whole page. */
export function parseProductPage(result: unknown): ProductPage {
  const r = (result ?? {}) as Record<string, unknown>;
  const items = unwrapList(r.products, "product");
  const products: AliProduct[] = [];
  for (const item of items) {
    const parsed = productSchema.safeParse(item);
    if (parsed.success) products.push(parsed.data);
  }
  return {
    products,
    skipped: items.length - products.length,
    totalRecords: parseAmount(r.total_record_count),
  };
}

export const categorySchema = z
  .object({
    category_id: id,
    category_name: z.string(),
    parent_category_id: id.optional(),
  })
  .transform((c) => ({
    id: c.category_id,
    name: c.category_name,
    parentId: c.parent_category_id ?? null,
  }));

export type AliCategory = z.output<typeof categorySchema>;

export function parseCategories(result: unknown): AliCategory[] {
  const r = (result ?? {}) as Record<string, unknown>;
  return unwrapList(r.categories, "category").flatMap((c) => {
    const parsed = categorySchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
}

export const promotionLinkSchema = z
  .object({
    source_value: z.string(),
    promotion_link: optionalText,
    message: z.string().optional(),
  })
  .transform((l) => ({
    sourceValue: l.source_value,
    promotionLink: l.promotion_link,
    message: l.message ?? null,
  }));

export type AliPromotionLink = z.output<typeof promotionLinkSchema>;

export function parsePromotionLinks(result: unknown): AliPromotionLink[] {
  const r = (result ?? {}) as Record<string, unknown>;
  return unwrapList(r.promotion_links, "promotion_link").flatMap((l) => {
    const parsed = promotionLinkSchema.safeParse(l);
    return parsed.success ? [parsed.data] : [];
  });
}

// product.sku.detail.get (doc 1795, read 2026-09-28). NOT built from a live response: the app has
// no permission for the method yet (InsufficientPermission), so this follows the documented
// fields and demo response. Per the docs the data sits in result.result, beside code and success;
// ae_item_info is typed Object but its demo is a one-item array; every value is a string except
// the display category ids and sku_id. Confirm with one real call once the permission is granted.
// A SKU's `link` has no tracking id and is never read: buying always goes through /go.

const docText = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined ? null : String(v).trim() || null));

const skuItemInfoSchema = z.object({
  product_id: id.optional(),
  review_number: docText,
  product_score: docText,
});

const rawSkuSchema = z.object({
  sku_id: id,
  color: docText,
  size: docText,
  sku_image_link: z.unknown().optional(),
  sale_price_with_tax: docText,
  currency: docText,
  min_delivery_days: docText,
  max_delivery_days: docText,
  ship_from_country: docText,
});

export interface AliSku {
  skuId: string;
  /** As AliExpress wrote them (with target_language HE, often machine-translated). */
  color: string | null;
  size: string | null;
  /** sku_image_link on the AliExpress media CDN; null otherwise. */
  imageUrl: string | null;
  /** sale_price_with_tax, in `currency`. */
  price: number | null;
  currency: string | null;
  /** AliExpress's delivery estimate to the ship_to_country, in days. */
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
  /** ship_from_country as sent (an ISO 3166 code such as "CN" in the docs). */
  shipFrom: string | null;
}

export interface AliSkuDetails {
  /** review_number and product_score. Parsed but not shown: /p shows only % positive and sales. */
  reviewCount: number | null;
  score: number | null;
  /** Up to 20 SKUs (the method's limit). */
  skus: AliSku[];
}

function wholeNumber(value: string | null): number | null {
  const n = parseAmount(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A plain array, or the gateway's { <wrapper>: [...] } form with one array inside. */
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const arrays = Object.values(value).filter(Array.isArray);
  return arrays.length === 1 ? arrays[0] : [];
}

/**
 * `result` of product.sku.detail.get → SKU details, or null when there are no SKUs or the answer
 * is for another product.
 */
export function parseSkuDetails(result: unknown, productId: string): AliSkuDetails | null {
  let r = isRecord(result) ? result : {};
  if (!("ae_item_sku_info" in r) && isRecord(r.result)) r = r.result;
  const rawInfo = Array.isArray(r.ae_item_info) ? r.ae_item_info[0] : r.ae_item_info;
  const info = skuItemInfoSchema.safeParse(rawInfo ?? {});
  if (info.success && info.data.product_id !== undefined && info.data.product_id !== productId) {
    return null;
  }
  const skus = new Map<string, AliSku>();
  for (const item of listOf(r.ae_item_sku_info)) {
    const parsed = rawSkuSchema.safeParse(item);
    if (!parsed.success || skus.has(parsed.data.sku_id)) continue;
    const s = parsed.data;
    skus.set(s.sku_id, {
      skuId: s.sku_id,
      color: s.color,
      size: s.size,
      imageUrl: mediaUrl(s.sku_image_link),
      price: parseAmount(s.sale_price_with_tax),
      currency: s.currency,
      minDeliveryDays: wholeNumber(s.min_delivery_days),
      maxDeliveryDays: wholeNumber(s.max_delivery_days),
      shipFrom: s.ship_from_country,
    });
  }
  if (!skus.size) return null;
  return {
    reviewCount: info.success ? wholeNumber(info.data.review_number) : null,
    score: info.success ? parseAmount(info.data.product_score) : null,
    skus: [...skus.values()],
  };
}
