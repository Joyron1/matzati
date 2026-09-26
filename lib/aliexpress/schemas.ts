// zod schemas for AliExpress affiliate responses, built from the saved fixtures in
// fixtures/aliexpress/ (captured 2026-09-26). Field notes from those real responses:
// - ids arrive as strings (the client quotes them to keep 17-digit sku_ids exact)
// - prices are decimal strings in major units; target_* fields carry the requested currency,
//   while sale_price/original_price stay in the store's currency (CNY or USD), so we ignore them
// - evaluate_rate ("97.2%") can be "" or missing; discount looks like "50%"
// - lists are wrapped: products.product[], categories.category[], product_small_image_urls.string[]
// - no store/seller rating field exists in any affiliate method
import { z } from "zod";
import { unwrapList } from "./unwrap";

/** "97.2%" → 97.2; "", "-", missing → null */
export function parsePercent(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number.parseFloat(String(value).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
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
  first_level_category_id: id.optional(),
  first_level_category_name: optionalText,
  second_level_category_id: id.optional(),
  second_level_category_name: optionalText,
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
  category: {
    firstId: string | null;
    firstName: string | null;
    secondId: string | null;
    secondName: string | null;
  };
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
    category: {
      firstId: p.first_level_category_id ?? null,
      firstName: p.first_level_category_name,
      secondId: p.second_level_category_id ?? null,
      secondName: p.second_level_category_name,
    },
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
