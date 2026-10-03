// The products of a category page, from the pages of its hot list (lib/catalog/load.ts). Pure.
// - Pages are merged in page order, once per product id: two hotproduct.query calls return
//   different lists (docs/aliexpress-api.md, Hot products), so page 2 of a later fetch may repeat
//   a product of page 1.
// - A slice (Home Decor of Home & Garden) keeps only its second-level category.
// - At most PER_SHOP products of one shop over the merged list, as on one list
//   (selectHotProducts): a shop of page 1 keeps its places.
// - Sub-category pills group the merged list by second-level category, with our Hebrew names
//   (lib/catalog/subcategories.ts); a category without a name of ours goes under "עוד".
import { PER_SHOP, type HotProduct } from "@/lib/hot/select";
import type { CatalogCategory } from "./categories";
import { OTHER_SUBCATEGORY, OTHER_SUBCATEGORY_LABEL, subcategoryNameHe } from "./subcategories";

/** One page of a hot list as the page reads it (a HotPool's fields). */
export interface ListPage {
  products: HotProduct[];
  checked: number;
  fetchedAt: string;
}

export interface CategoryProducts {
  /** In page order, each page by 30-day sales; the page sorts them for its view. */
  products: HotProduct[];
  /** Products AliExpress returned on the loaded pages, before our filters. */
  checked: number;
  /** The oldest time a loaded page was fetched (ISO): every price shown was checked then or later. */
  checkedFrom: string;
}

/** The loaded pages of `category`'s list as one list (see the file comment). Null with no page. */
export function mergeCategoryPages(
  category: Pick<CatalogCategory, "slice">,
  pages: ListPage[],
  perShop: number = PER_SHOP,
): CategoryProducts | null {
  if (!pages.length) return null;
  const sub = category.slice && !category.slice.directFetch ? category.slice.subcategoryId : null;
  const seen = new Set<string>();
  const shops = new Map<string, number>();
  const products: HotProduct[] = [];
  for (const page of pages) {
    for (const p of page.products) {
      if (seen.has(p.productId)) continue;
      if (sub !== null && p.subcategoryId !== sub) continue;
      const shop = p.shopId;
      if (shop !== null && (shops.get(shop) ?? 0) >= perShop) continue;
      seen.add(p.productId);
      if (shop !== null) shops.set(shop, (shops.get(shop) ?? 0) + 1);
      products.push(p);
    }
  }
  const [checkedFrom] = pages.map((p) => p.fetchedAt).sort();
  return { products, checked: pages.reduce((n, p) => n + p.checked, 0), checkedFrom };
}

/** The pill a product belongs to on its first-level category's page. */
export function subcategoryOf(firstLevelId: string, p: Pick<HotProduct, "subcategoryId">): string {
  const id = p.subcategoryId;
  return id && subcategoryNameHe(firstLevelId, id) ? id : OTHER_SUBCATEGORY;
}

export interface SubcategoryPill {
  /** A second-level id, or OTHER_SUBCATEGORY. */
  id: string;
  labelHe: string;
  count: number;
}

/**
 * The sub-category pills of a whole-list category: the second-level categories its products are
 * in, most products first (then by name), with "עוד" last. Empty for a slice, and when everything
 * is in one group (a pill would filter nothing).
 */
export function subcategoryPills(
  category: Pick<CatalogCategory, "firstLevelId" | "slice">,
  products: Pick<HotProduct, "subcategoryId">[],
): SubcategoryPill[] {
  if (category.slice) return [];
  const counts = new Map<string, number>();
  for (const p of products) {
    const id = subcategoryOf(category.firstLevelId, p);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  const named = [...counts]
    .filter(([id]) => id !== OTHER_SUBCATEGORY)
    .map(([id, count]) => ({
      id,
      labelHe: subcategoryNameHe(category.firstLevelId, id) ?? "",
      count,
    }))
    .sort((a, b) => b.count - a.count || a.labelHe.localeCompare(b.labelHe, "he"));
  const other = counts.get(OTHER_SUBCATEGORY);
  return other
    ? [...named, { id: OTHER_SUBCATEGORY, labelHe: OTHER_SUBCATEGORY_LABEL, count: other }]
    : named;
}

/** `products` in sub-category `sub` (undefined: all). No API call: a filter of the loaded list. */
export function inSubcategory<T extends Pick<HotProduct, "subcategoryId">>(
  firstLevelId: string,
  products: T[],
  sub: string | undefined,
): T[] {
  return sub === undefined
    ? products
    : products.filter((p) => subcategoryOf(firstLevelId, p) === sub);
}
