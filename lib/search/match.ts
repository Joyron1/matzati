// The order of a photo or link search ("match", owner request 2026-10-23): what AliExpress returns
// for the keywords the photo or page gave, with the products that are the requested product first.
// A product is an exact match when its English title passes the smart search's relevance checks
// (type gate, requirements, a small capacity, a child's age, the price bounds:
// matchesRequest in lib/ranking/rank.ts); exact matches come by trust tier (FILTERS, FILL_TIER,
// LOOSE_TIER, then the rest), AliExpress's order kept within a tier. The others follow only while
// fewer exact matches than a first view were found.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_FIRST_VIEW } from "@/lib/config/site";
import { matchesRequest, trustTierOf, type TrustTier } from "@/lib/ranking/rank";
import type { SearchFilters } from "./filters";

/** The most products a match search keeps (one productdetail.get gives them Hebrew titles). */
export const MATCH_KEPT = 20;

const TIER_RANK: Record<TrustTier, number> = { standard: 0, fill: 1, loose: 2 };
const tierRank = (p: AliProduct) => {
  const t = trustTierOf(p);
  return t === null ? 3 : TIER_RANK[t];
};

export interface MatchOrder {
  products: AliProduct[];
  /** The ids of the exact matches among `products` (they come first). */
  exactIds: Set<string>;
}

/** `products` (already showable, in AliExpress's order) in the match order, up to MATCH_KEPT. */
export function matchOrder(products: readonly AliProduct[], f: SearchFilters): MatchOrder {
  const exact = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => matchesRequest(p, f))
    .sort((a, b) => tierRank(a.p) - tierRank(b.p) || a.i - b.i)
    .map(({ p }) => p);
  const exactIds = new Set(exact.map((p) => p.productId));
  const rest = products.filter((p) => !exactIds.has(p.productId));
  const list = (exact.length >= RESULTS_FIRST_VIEW ? exact : [...exact, ...rest]).slice(
    0,
    MATCH_KEPT,
  );
  return {
    products: list,
    exactIds: new Set(list.filter((p) => exactIds.has(p.productId)).map((p) => p.productId)),
  };
}
