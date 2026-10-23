// The AliExpress first-level categories a search may be assigned to (owner request 2026-10-23:
// "שרשרת מוסנייט" belongs in jewelry, "מכונית על שלט" in toys). From category.get
// (fixtures/aliexpress/aliexpress.affiliate.category.get.json, 40 first-level ids), without the
// test, virtual, special and second-hand ones. The parse picks at most two of these ids
// (lib/llm/parse.ts) and the fetch sends them as category_ids (lib/search/fetch-policy.ts).
// Verified 2026-10-23 (scripts/probe-category.ts): "remote control car" without a category had 32
// toys of 49 (garage remotes, car LED strips, security items); with 26, 50 of 50; a comma list
// "26,34" works.

export const SEARCH_CATEGORIES: readonly { id: string; name: string }[] = [
  { id: "2", name: "Food" },
  { id: "3", name: "Apparel & Accessories" },
  { id: "200000345", name: "Women's Clothing" },
  { id: "200000343", name: "Men's Clothing" },
  { id: "200000297", name: "Apparel Accessories" },
  { id: "200574005", name: "Underwear" },
  { id: "322", name: "Shoes" },
  { id: "201768104", name: "Sports Shoes, Clothing & Accessories" },
  { id: "1524", name: "Luggage & Bags" },
  { id: "36", name: "Jewelry & Accessories" },
  { id: "1511", name: "Watches" },
  { id: "200165144", name: "Hair Extensions & Wigs" },
  { id: "66", name: "Beauty & Health" },
  { id: "1501", name: "Mother & Kids" },
  { id: "26", name: "Toys & Hobbies" },
  { id: "18", name: "Sports & Entertainment" },
  { id: "15", name: "Home & Garden" },
  { id: "1503", name: "Furniture" },
  { id: "6", name: "Home Appliances" },
  { id: "39", name: "Lights & Lighting" },
  { id: "13", name: "Home Improvement" },
  { id: "1420", name: "Tools" },
  { id: "30", name: "Security & Protection" },
  { id: "44", name: "Consumer Electronics" },
  { id: "509", name: "Phones & Telecommunications" },
  { id: "202192403", name: "Phones & Telecommunications Accessories" },
  { id: "7", name: "Computer & Office" },
  { id: "21", name: "Office & School Supplies" },
  { id: "502", name: "Electronic Components & Supplies" },
  { id: "34", name: "Automobiles, Parts & Accessories" },
  { id: "201355758", name: "Motorcycle Equipments & Parts" },
  { id: "320", name: "Weddings & Events" },
  { id: "202228412", name: "Books & Cultural Merchandise" },
  { id: "200000532", name: "Novelty & Special Use" },
  { id: "202216001", name: "Industrial & Business" },
];

/** At most this many categories per search (a comma list in category_ids). */
export const MAX_SEARCH_CATEGORIES = 2;

const KNOWN = new Set(SEARCH_CATEGORIES.map((c) => c.id));

/** The model's ids kept: known ones only, once each, in its order, at most MAX_SEARCH_CATEGORIES. */
export function knownCategoryIds(ids: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of ids ?? []) {
    const id = String(raw).trim();
    if (KNOWN.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_SEARCH_CATEGORIES) break;
  }
  return out;
}

/** The list as the prompts give it: "id name" pairs. */
export const CATEGORY_LIST_TEXT = SEARCH_CATEGORIES.map((c) => `${c.id} ${c.name}`).join("; ");

/**
 * The rule the parse prompts share (lib/llm/parse.ts, the photo and link prompts in
 * lib/search/from-input.ts): which ids to write in category_ids.
 */
export const CATEGORY_RULE = `- category_ids: the AliExpress first-level categories where sellers list this exact product, from this list (id name): ${CATEGORY_LIST_TEXT}. Write 1 id, or 2 when sellers really split the product between two (phone cases: 202192403 and 509; earbuds: 44 and 509). A toy is 26, even a baby's; jewelry is 36; a car accessory is 34 (an RC or toy car is 26). [] when you are not sure.`;
