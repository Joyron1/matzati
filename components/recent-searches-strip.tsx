import Link from "next/link";
import { connection } from "next/server";
import { ChevronLeft } from "lucide-react";
import { uniqueByProduct } from "@/lib/recent/display";
import { latestRecentSearches } from "@/lib/recent/queries";
import { RECENT_PAGE_SIZE } from "@/lib/recent/types";
import { RecentSearchCard } from "./recent-search-card";

const STRIP_SIZE = 6;

/**
 * Home page "חיפשו לאחרונה": the products of the newest listed searches, one card per product;
 * hidden when there are none. The home page is indexed, so it shows the product we understood,
 * never the visitor's own words (owner decision 2026-09-27; /searches shows the queries, noindex).
 */
export async function RecentSearchesStrip() {
  await connection(); // "לפני שעה" depends on the time of the visit
  // A full page, so products searched twice ("בובת סוניק", "בובת סוניק לילד") still fill 6 cards.
  const searches = uniqueByProduct(await latestRecentSearches(RECENT_PAGE_SIZE), STRIP_SIZE);
  if (searches.length === 0) return null;
  const now = new Date();
  return (
    <section aria-labelledby="recent-title" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 id="recent-title" className="font-display text-3xl">
          חיפשו לאחרונה
        </h2>
        <Link
          href="/searches"
          className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-ink underline-offset-4 hover:underline"
        >
          לכל החיפושים האחרונים
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      </div>
      <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {searches.map((search) => (
          <li key={search.queryNorm} className="min-w-0">
            <RecentSearchCard search={search} now={now} compact headingLevel={3} />
          </li>
        ))}
      </ul>
    </section>
  );
}
