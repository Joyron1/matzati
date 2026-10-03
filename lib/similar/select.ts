// "מוצרים דומים שיעניינו אתכם" on /p: other products of the list that led to the page, in that
// list's order. Pure: the reads are in ./load.ts, and nothing here fetches, ranks or writes.
// - From a search (/p?q=): the other ranked products of that query's cached result set.
// - From a hot list (/p?from=hot&cat=<catalog key>, /products): the other products of that cached
//   hot list, by 30-day sales.
// Only products with a row in `products` are shown, since /p serves nothing else (a fetch saves
// every product it kept, RESULTS_KEPT; result sets cached before that may lack rows past the pages
// they showed). Hebrew titles are shown with the known transliterations fixed
// (lib/transliterations.ts).
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { hotProductHref } from "@/lib/hot/params";
import type { HotProduct } from "@/lib/hot/select";
import { hotTitle } from "@/lib/product-title";
import { sharedMarkOf } from "@/lib/ranking/shared-numbers";
import type { CachedResults } from "@/lib/search/store";
import { fixTransliterations } from "@/lib/transliterations";
import type { ResultProduct } from "@/lib/types";

/** At most this many cards: two rows of four on a wide screen. */
export const SIMILAR_LIMIT = 8;

export interface SimilarItem {
  productId: string;
  /** Its /p page, with the same way back (q, or from=hot and the category). */
  href: string;
  /** Our Hebrew title when one is stored, else AliExpress's (English, or Hebrew for a hot list). */
  title: string;
  imageUrl: string | null;
  price: Pick<
    ResultProduct,
    "price_ils" | "original_price_ils" | "price_is_approx" | "discount_pct"
  >;
  trust: Pick<ResultProduct, "positive_feedback_pct" | "units_sold" | "shared_numbers">;
}

export type SimilarSource =
  | { kind: "search" }
  | {
      kind: "hot";
      /** Our Hebrew name of the list's category, or null. */
      categoryHe: string | null;
    };

export interface SimilarProducts {
  source: SimilarSource;
  items: SimilarItem[];
  /** When AliExpress returned the list and its prices (ISO): the cards show those prices. */
  checkedAt: string;
}

/** /p of a search result, as the result cards link it (components/product-cards.tsx). */
export function searchProductHref(productId: string, q: string): string {
  const path = `/p/${encodeURIComponent(productId)}`;
  return q ? `${path}?q=${encodeURIComponent(q)}` : path;
}

/** The first `limit` of `list` in its order, once each, without `currentId` and with a row. */
function pick<T>(
  list: T[],
  idOf: (item: T) => string,
  currentId: string,
  stored: ReadonlyMap<string, unknown>,
  limit: number,
): T[] {
  const seen = new Set<string>([currentId]);
  const out: T[] = [];
  for (const item of list) {
    const id = idOf(item);
    if (seen.has(id) || !stored.has(id)) continue;
    seen.add(id);
    out.push(item);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * The other products of a cached result set, in the order the search ranked them, with the numbers
 * and prices the results page showed (as fetched at `createdAt`, the shared-numbers mark included).
 * The title is the line written for that result set (or the title its places 6-10 showed), else
 * our stored title, else AliExpress's.
 * `stored` maps the ids that have a row to their stored Hebrew title. Null when none is left.
 */
export function similarFromSearch(
  cached: Pick<CachedResults, "products" | "explanations" | "createdAt" | "titles">,
  {
    currentId,
    q,
    stored,
    limit = SIMILAR_LIMIT,
  }: {
    currentId: string;
    q: string;
    stored: ReadonlyMap<string, string | null>;
    limit?: number;
  },
): SimilarProducts | null {
  const products = pick(cached.products, (p) => p.productId, currentId, stored, limit);
  if (!products.length) return null;
  return {
    source: { kind: "search" },
    checkedAt: cached.createdAt,
    items: products.map((p) => {
      // A line's title, else the title places 6-10 showed (the titles call), else a stored one.
      const titled = cached.titles?.[p.productId];
      const written =
        cached.explanations[p.productId]?.title_he ?? (typeof titled === "string" ? titled : null);
      return searchItem(p, q, written, stored);
    }),
  };
}

function searchItem(
  p: AliProduct,
  q: string,
  written: string | null | undefined,
  stored: ReadonlyMap<string, string | null>,
): SimilarItem {
  const shared = sharedMarkOf(p);
  // Our Hebrew title (written for that result set, or stored), read like any cached title of ours.
  const ours = written?.trim() || stored.get(p.productId);
  return {
    productId: p.productId,
    href: searchProductHref(p.productId, q),
    title: ours ? fixTransliterations(ours, p.title) : p.title,
    imageUrl: p.mainImageUrl || p.imageUrls[0] || null,
    price: {
      price_ils: p.price,
      original_price_ils: p.originalPrice,
      price_is_approx: p.currency !== "ILS",
      discount_pct: p.discountPct,
    },
    trust: {
      positive_feedback_pct: p.positiveFeedbackPct,
      units_sold: p.unitsSold,
      ...(shared ? { shared_numbers: shared } : {}),
    },
  };
}

/**
 * The other products of a cached hot list (already passed through FILTERS, lib/hot/queries.ts),
 * in its order (30-day sales, as /hot shows it), with AliExpress's Hebrew titles as the list's
 * cards show them (known transliterated loan words fixed, hotTitle). Their links keep from=hot and
 * the category.
 */
export function similarFromHot(
  products: HotProduct[],
  {
    currentId,
    categoryKey,
    categoryHe,
    fetchedAt,
    stored,
    limit = SIMILAR_LIMIT,
  }: {
    currentId: string;
    /** The catalog key of the list's category (lib/catalog/categories.ts), kept in the links. */
    categoryKey: string;
    categoryHe: string | null;
    fetchedAt: string;
    stored: ReadonlyMap<string, unknown>;
    limit?: number;
  },
): SimilarProducts | null {
  const picked = pick(products, (p) => p.productId, currentId, stored, limit);
  if (!picked.length) return null;
  return {
    source: { kind: "hot", categoryHe },
    checkedAt: fetchedAt,
    items: picked.map((p) => ({
      productId: p.productId,
      href: hotProductHref(p.productId, categoryKey),
      title: hotTitle(p.title),
      imageUrl: p.imageUrl || null,
      price: {
        price_ils: p.price,
        original_price_ils: p.originalPrice,
        price_is_approx: false,
        discount_pct: p.discountPct,
      },
      trust: { positive_feedback_pct: p.positiveFeedbackPct, units_sold: p.unitsSold },
    })),
  };
}
