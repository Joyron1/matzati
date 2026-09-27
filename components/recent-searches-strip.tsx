import Link from "next/link";
import { connection } from "next/server";
import { ChevronLeft, Search, TrendingUp } from "lucide-react";
import { productLabelOf, uniqueByProduct } from "@/lib/recent/display";
import { latestRecentSearches } from "@/lib/recent/queries";
import { RECENT_PAGE_SIZE } from "@/lib/recent/types";
import { searchHref } from "@/lib/search-url";
import { ProductImage } from "./product-image";

const STRIP_SIZE = 6;

/** The title row: the heading and, on the same line, the link to every recent search. */
function Title() {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-center gap-x-3 text-sm">
      <h2 id="hot-title" className="inline-flex items-center gap-1.5 font-bold text-ink">
        <TrendingUp aria-hidden className="size-4 text-accent-ink" />
        חיפושים חמים
      </h2>
      <Link
        href="/searches"
        className="inline-flex min-h-11 items-center gap-0.5 font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        לכל החיפושים האחרונים
        <ChevronLeft aria-hidden className="size-4" />
      </Link>
    </div>
  );
}

/**
 * Home page "חיפושים חמים", right under the search composer: one pill per product of the newest
 * listed searches; hidden when there are none. The home page is indexed, so a pill shows the
 * product we understood, never the visitor's own words (owner decision 2026-09-27; /searches
 * shows the queries, noindex).
 */
export async function RecentSearchesStrip() {
  await connection(); // recent = as of this visit, not of the build
  // A full page, so products searched twice ("בובת סוניק", "בובת סוניק לילד") still fill the row.
  const searches = uniqueByProduct(await latestRecentSearches(RECENT_PAGE_SIZE), STRIP_SIZE);
  if (searches.length === 0) return null;
  return (
    <section aria-labelledby="hot-title" className="space-y-2">
      <Title />
      <ul className="flex flex-wrap justify-center gap-2">
        {searches.map((search) => {
          const [photo] = search.images;
          return (
            <li key={search.queryNorm} className="max-w-full">
              <Link
                // from=recent: the visitor did not type it, so this run is never listed again (it
                // would put the pill back on top with every click).
                href={searchHref({ q: search.query, from: "recent" })}
                // Crawlers may follow this page, and an expired search costs a new run; the target
                // is noindex anyway. No prefetch: a row of pills would fire a request per pill.
                rel="nofollow"
                prefetch={false}
                className="flex h-11 max-w-full items-center gap-2 rounded-full border border-line bg-surface ps-1 pe-4 text-sm font-medium text-ink hover:border-accent hover:text-accent-ink"
              >
                {photo ? (
                  // The label names the product; the photo only helps scanning.
                  <ProductImage
                    src={photo.src}
                    alt=""
                    // The edge keeps a white product photo from glaring inside a dark pill.
                    className="size-9 shrink-0 rounded-full ring-1 ring-line"
                    iconClassName="size-4"
                    sizes="36px"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink"
                  >
                    <Search className="size-4" />
                  </span>
                )}
                <span className="truncate">{productLabelOf(search)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const PLACEHOLDER_WIDTHS = ["w-28", "w-24", "w-32", "w-26", "w-22", "w-30"];

/**
 * Roughly the strip's height, so the tips under it do not jump when it streams in. No heading:
 * the strip renders nothing when there are no searches to show, and a title must not flash.
 */
export function RecentSearchesStripPlaceholder() {
  return (
    <div aria-hidden className="space-y-2">
      <div className="h-11" />
      <div className="flex flex-wrap justify-center gap-2">
        {PLACEHOLDER_WIDTHS.map((w) => (
          <div key={w} className={`h-11 animate-pulse rounded-full bg-surface-2 ${w}`} />
        ))}
      </div>
    </div>
  );
}
