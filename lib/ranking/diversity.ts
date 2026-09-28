// Products that really differ (docs/search-quality-plan.md, item 4): near-duplicate listings
// removed, and, under the admin's shop cap setting (SHOP_CAP_MODES), one shop may not fill the
// list. Pure: no I/O.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { DEDUP, SHOP_CAPS, type ShopCapMode } from "./config";
import { stem, tokenize } from "./match";

interface Listing {
  title: string;
  first: string | undefined;
  model: string | null;
  shop: string | null;
  sales: number | null;
  tokens: Set<string>;
}

/** Leading letters of tokens that look like models but are specs or compatibility: ipx8, usb3, v5. */
const SPEC_PREFIXES = new Set(["ip", "ipx", "usb", "pd", "qc", "v", "bt", "wifi", "hdmi", "gen"]);

/**
 * The listing's own model token near the start ("POLVCDG X9", "Original SP16"). Tokens after
 * "for" name what it fits, not what it is, and so does a model the shopper searched for ("s24"
 * in a search for a Galaxy S24 case, where "Samsung S24 Case ..." titles are all different cases).
 */
function modelToken(tokens: string[], searched: ReadonlySet<string>): string | null {
  for (const t of tokens.slice(0, DEDUP.modelTokenWindow)) {
    if (t === "for") return null;
    const m = /^([a-z]+)\d+[a-z]*$/.exec(t);
    if (m && !SPEC_PREFIXES.has(m[1]) && !searched.has(t)) return t;
  }
  return null;
}

function listing(p: AliProduct, searched: ReadonlySet<string>): Listing {
  const tokens = tokenize(p.title).map(stem);
  return {
    title: tokens.join(" "),
    first: tokens[0],
    model: modelToken(tokens, searched),
    shop: p.shop.id,
    sales: p.unitsSold,
    tokens: new Set(tokens),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** The same model or a lettered edition of it: "s32" and "s32pro", not "x7" and "x70". */
const sameModelLine = (a: string, b: string) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short) && /^[a-z]*$/.test(long.slice(short.length));
};

function isSameProduct(a: Listing, b: Listing): boolean {
  if (a.title === b.title) return true;
  const sameBrand = a.first === b.first;
  if (sameBrand && a.model !== null && b.model !== null && sameModelLine(a.model, b.model)) {
    return true;
  }
  const overlap = jaccard(a.tokens, b.tokens);
  if (overlap >= DEDUP.crossShopJaccard) return true;
  if (a.shop === null || a.shop !== b.shop) return false;
  if (overlap >= DEDUP.sameShopJaccard) return true;
  // One shop's variants often all show the listing's sales: the same number twice is one product.
  return (
    a.sales !== null &&
    a.sales >= DEDUP.sameSalesMin &&
    a.sales === b.sales &&
    overlap >= DEDUP.sameSalesJaccard
  );
}

/**
 * Drops listings of a product already in the list; the earlier (higher-ranked) one stays.
 * `searched` holds the shopper's own words (see modelToken).
 */
export function dedupeBy<T>(
  ranked: T[],
  productOf: (item: T) => AliProduct,
  searched: ReadonlySet<string> = new Set(),
): T[] {
  const kept: { item: T; l: Listing }[] = [];
  for (const item of ranked) {
    const l = listing(productOf(item), searched);
    if (!kept.some((k) => isSameProduct(k.l, l))) kept.push({ item, l });
  }
  return kept.map((k) => k.item);
}

/** dedupeBy for a list of products. */
export function dedupeListings(
  ranked: AliProduct[],
  searched: ReadonlySet<string> = new Set(),
): AliProduct[] {
  return dedupeBy(ranked, (p) => p, searched);
}

/**
 * Reorders a ranked list under the shop cap of `mode` (SHOP_CAPS): one shop has at most
 * `firstPage` products in the first `pageSize` places and `kept` in the first `keptSize`. A
 * product over its shop's cap waits for the first place where it fits, and it takes a place early
 * only when no product of another shop is left, so a pool from one shop still fills the page.
 * Nothing is dropped, and the order is otherwise the ranking's (the same rule as lib/hot/select.ts,
 * which caps a shop at 2). Mode "none" keeps the ranking's order as it is.
 */
export function diversifyShops<T extends Pick<AliProduct, "shop">>(
  ranked: readonly T[],
  pageSize: number,
  mode: ShopCapMode,
): T[] {
  const shopCap = SHOP_CAPS[mode];
  if (!shopCap) return [...ranked];
  const cap = (place: number) =>
    place < pageSize
      ? shopCap.firstPage
      : place < shopCap.keptSize
        ? shopCap.kept
        : Number.POSITIVE_INFINITY;
  const counts = new Map<string, number>();
  const queue = [...ranked];
  const out: T[] = [];
  while (queue.length) {
    const limit = cap(out.length);
    const fits = queue.findIndex((p) => p.shop.id === null || (counts.get(p.shop.id) ?? 0) < limit);
    const [next] = queue.splice(Math.max(0, fits), 1);
    if (next.shop.id !== null) counts.set(next.shop.id, (counts.get(next.shop.id) ?? 0) + 1);
    out.push(next);
  }
  return out;
}
