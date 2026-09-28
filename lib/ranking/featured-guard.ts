// Safety net for the first page (docs/search-quality-plan.md, item 2): the explain step marks a
// result that is not the searched product ("אביזר משלים, לא ...", as EXPLAIN_SYSTEM in
// lib/llm/explain.ts asks it to), and code moves that result out of the first page. The model
// only marks; the code decides. Pure: no I/O.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { diversifyShops } from "./diversity";

/** How EXPLAIN_SYSTEM tells the model to open the line of a partial fit. */
const PARTIAL_FIT_OPENINGS = ["אביזר משלים"];

/** Niqqud, geresh/gershayim and maqaf variants, extra spaces: compared as plain letters. */
function plain(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, "")
    .replace(/[״"׳'־\-\u2013\u2014,.:;!?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when an explanation says its product is not what was searched for: it opens like a
 * partial fit ("אביזר משלים"), or it says "לא <product_he>" (with or without the article ה).
 */
export function explanationSaysNotProduct(whyHe: string, productHe: string): boolean {
  const why = plain(whyHe);
  if (PARTIAL_FIT_OPENINGS.some((opening) => why.startsWith(opening))) return true;
  const label = plain(productHe);
  return label.length > 0 && (why.includes(`לא ${label}`) || why.includes(`לא ה${label}`));
}

/**
 * Moves every first-page product whose explanation says it is not the searched product
 * (explanationSaysNotProduct) to the end of the list, so the next ones move up. The rest keeps
 * the ranking's order under the same shop cap (diversifyShops), and nothing is dropped.
 * `demoted` lists the moved ids (empty: the order is unchanged).
 *
 * For the pipeline: call it on the ranked list (rankWithFill) after explaining the first page,
 * with the same `productHe` the explanations were written for. A product that moves up into the
 * first page has no explanation yet: give it the data sentence (whyFromData in
 * lib/llm/explain.ts, no extra call), then cache the corrected order.
 */
export function demoteFlaggedLeads<T extends { productId: string } & Pick<AliProduct, "shop">>(
  ranked: readonly T[],
  explanations: Readonly<Record<string, { why_he: string } | undefined>>,
  productHe: string,
  pageSize: number,
): { ranked: T[]; demoted: string[] } {
  const flagged = new Set(
    ranked
      .slice(0, pageSize)
      .filter((p) => {
        const why = explanations[p.productId]?.why_he;
        return why !== undefined && explanationSaysNotProduct(why, productHe);
      })
      .map((p) => p.productId),
  );
  if (!flagged.size) return { ranked: [...ranked], demoted: [] };
  return {
    ranked: [
      ...diversifyShops(
        ranked.filter((p) => !flagged.has(p.productId)),
        pageSize,
      ),
      ...ranked.filter((p) => flagged.has(p.productId)),
    ],
    demoted: [...flagged],
  };
}
