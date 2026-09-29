import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PendingNavigation } from "@/components/pending-navigation";
import { SearchComposer } from "@/components/search-composer";
import { SearchView } from "@/components/search-view";
import { BRAND } from "@/lib/config/brand";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import {
  firstParam,
  parseArrival,
  parseFrom,
  parseSort,
  parseWithout,
  searchHref,
} from "@/lib/search-url";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import { startSearchForRequest } from "@/lib/search/server";
import { pageMetadata } from "@/lib/seo/page-meta";
import { completeResults, rankedSignal, understoodSignal } from "./results";

// A fresh search (parse, up to 3 AliExpress calls, explain) takes 7-15 s; give it room.
export const maxDuration = 60;

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const q = firstParam((await searchParams).q)
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
  // A shared search link previews as the search it opens (its card is the brand card). Not
  // indexed, so no canonical.
  return {
    ...pageMetadata({
      title: q ? `חיפוש: ${q}` : "חיפוש",
      description: q
        ? `${RESULTS_PER_PAGE} מוצרים מאלי אקספרס שעברו סינון לפי משוב של קונים ומספר מכירות, לחיפוש ״${q}״.`
        : BRAND.description,
      path: q ? searchHref({ q }) : "/",
      canonical: false,
    }),
    robots: { index: false },
  };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const q = firstParam(params.q).trim().slice(0, MAX_QUERY_LENGTH);
  if (!q) redirect("/");

  const sort = parseSort(params.sort);
  const without = parseWithout(params.without);
  // A recent-search card or an example query: searched as usual, never listed on /searches.
  const from = parseFrom(params.from);
  // The same, plus an ad or campaign landing (utm_source, gclid): logged as search_log.origin.
  const arrival = parseArrival(params);
  const href = searchHref({ q, sort, without, from });

  // One waiting screen, then the complete results at once (components/search-view.tsx). The page
  // itself never waits for the search: it starts it and passes its real moments as promises (the
  // chips once the query is understood, then that the products are ranked and their lines are
  // being written) with the finished results, rendered on the server once every line is written.
  // The results carry this request's search_log uid, which their buy buttons pass to /go.
  // SearchView is keyed by the query: another sort or a removed chip of the same query keeps the
  // results on screen, dimmed, until the next view is complete; a new query starts with the wait.
  const started = startSearchForRequest({ q, without, sort, arrival }, await headers());
  const view = {
    understood: understoodSignal(started),
    ranked: rankedSignal(started),
    results: completeResults(started, { q, sort, without, retryHref: href }),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <SearchComposer variant="bar" defaultValue={q} />
      <PendingNavigation>
        <SearchView key={q} query={q} view={view} />
      </PendingNavigation>
    </div>
  );
}
