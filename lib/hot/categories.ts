// The categories /hot offers. A fixed list, so the pills never cost an AliExpress call: a
// category's hot list is fetched only when someone opens it (lib/hot/queries.ts), and only ids
// from this list are ever fetched, so a crawler cannot spend quota on made-up categories.
// First-level ids from aliexpress.affiliate.category.get (fixtures/aliexpress); the Hebrew names
// are ours (categoryLabelHe), never AliExpress's machine-translated ones.
import { categoryLabelHe } from "@/lib/tips/category";

/** Popular first-level categories, in pill order. */
export const HOT_CATEGORY_IDS = [
  "44", // Consumer Electronics (probed 2026-09-28: 41 of 46 passed FILTERS)
  "202192403", // Phones & Telecommunications Accessories
  "15", // Home & Garden (40 of 50 on 2026-09-28)
  "6", // Home Appliances
  "7", // Computer & Office
  "34", // Automobiles, Parts & Accessories (36 of 45 on 2026-09-28)
  "18", // Sports & Entertainment
  "66", // Beauty & Health
  "26", // Toys & Hobbies
  "1501", // Mother & Kids
  "1420", // Tools
  "39", // Lights & Lighting
] as const;

export type HotCategoryId = (typeof HOT_CATEGORY_IDS)[number];

/**
 * The home carousel and /hot without a category ("מבחר") mix these categories' lists. AliExpress's
 * list without a category is no mix: 25 of 47 were phone cases in the probe, and on 2026-09-28
 * only 6 of 49 were left once each second-level category was capped at 2. The lists are shared
 * with the pills, and a cold mix costs one call per category.
 */
export const MIX_CATEGORY_IDS = ["44", "15", "34", "26"] as const satisfies HotCategoryId[];

export interface HotCategory {
  id: HotCategoryId;
  labelHe: string;
}

export function isHotCategoryId(value: string): value is HotCategoryId {
  return (HOT_CATEGORY_IDS as readonly string[]).includes(value);
}

/** The pills, with their Hebrew names. An id without a name is left out (a test guards this). */
export function hotCategories(): HotCategory[] {
  return HOT_CATEGORY_IDS.flatMap((id) => {
    const labelHe = categoryLabelHe(id);
    return labelHe ? [{ id, labelHe }] : [];
  });
}

/** Hebrew name of a pill's category, or null for any other id. */
export function hotCategoryLabel(id: string): string | null {
  return isHotCategoryId(id) ? categoryLabelHe(id) : null;
}
