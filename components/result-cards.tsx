import { RESULTS_PER_PAGE } from "@/lib/config/site";
import type { LoggedResult } from "@/lib/search-url";
import { CompactProductCard, FeaturedProductCard, StandardProductCard } from "./product-cards";

/**
 * Places 6-10 of the first view (RESULTS_FIRST_VIEW, owner decision 2026-09-30), right under the
 * explained page: a small heading and a grid of standard cards (StandardProductCard), two in a row
 * on phones, three from md, five from xl. A list, so a screen reader says how many there are.
 */
export function ExtraResultCards({ results, q }: { results: LoggedResult[]; q: string }) {
  if (!results.length) return null;
  const first = RESULTS_PER_PAGE + 1;
  const last = RESULTS_PER_PAGE + results.length;
  return (
    <section aria-labelledby="first-view-extra" className="space-y-3">
      <div className="space-y-1">
        <h2 id="first-view-extra" className="text-lg font-bold">
          עוד אפשרויות שעברו את הסינון
        </h2>
        <p className="text-sm text-muted">
          {results.length > 1 ? (
            <>
              מקומות <bdi dir="ltr">{first}</bdi> עד <bdi dir="ltr">{last}</bdi> בדירוג
            </>
          ) : (
            <>
              מקום <bdi dir="ltr">{first}</bdi> בדירוג
            </>
          )}
          , בלי ההסבר ״למה בחרנו״.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {results.map((p, i) => (
          <li key={p.product_id}>
            <StandardProductCard product={p} rank={first + i} q={q} />
          </li>
        ))}
      </ul>
    </section>
  );
}

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
