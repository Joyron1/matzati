import Link from "next/link";
import { connection } from "next/server";
import { ChevronLeft } from "lucide-react";
import { latestRecentSearches } from "@/lib/recent/queries";
import { RecentSearchCard } from "./recent-search-card";

const STRIP_SIZE = 6;

/** Home page "חיפשו לאחרונה": the newest listed searches; hidden when there are none. */
export async function RecentSearchesStrip() {
  await connection(); // "לפני 5 דקות" depends on the time of the visit
  const searches = await latestRecentSearches(STRIP_SIZE);
  if (searches.length === 0) return null;
  const now = new Date();
  return (
    // The home page is indexed and these are visitors' own words: keep them out of search
    // snippets (/searches itself is noindex).
    <section
      aria-labelledby="recent-title"
      data-nosnippet
      className="mx-auto mt-16 max-w-6xl px-4 sm:px-6"
    >
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
