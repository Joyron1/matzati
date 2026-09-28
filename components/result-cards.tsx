import type { LoggedResult } from "@/lib/search-url";
import { CompactProductCard, FeaturedProductCard } from "./product-cards";

/**
 * The first page of results on /search, complete (titles and lines written): the featured card
 * and one compact card for each other result of the page (RESULTS_PER_PAGE in all). Up to two
 * compact cards stand in one column beside the featured card from lg. With more, the featured card
 * takes the full width (its photo beside its text, FeaturedProductCard) and the compact cards
 * stand under it in two columns from sm, an odd last one in a row of its own.
 */
export function ResultCards({ results, q }: { results: LoggedResult[]; q: string }) {
  const [top, ...rest] = results;
  if (!top) return null;
  const columns = rest.length > 2;
  return (
    <div
      className={
        columns
          ? "grid gap-5"
          : "grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start"
      }
    >
      <FeaturedProductCard product={top} rank={1} q={q} />
      {rest.length > 0 && (
        <div
          className={
            columns
              ? "grid gap-5 sm:grid-cols-2 sm:[&>:last-child:nth-child(odd)]:col-span-2"
              : "grid gap-5"
          }
        >
          {rest.map((p, i) => (
            <CompactProductCard key={p.product_id} product={p} rank={i + 2} q={q} />
          ))}
        </div>
      )}
    </div>
  );
}
