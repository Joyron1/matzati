import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PendingNavigation } from "@/components/pending-navigation";
import { SearchComposer } from "@/components/search-composer";
import { SearchView } from "@/components/search-view";
import { BRAND } from "@/lib/config/brand";
import { RESULTS_FIRST_VIEW } from "@/lib/config/site";
import {
  firstParam,
  parseArrival,
  parseFrom,
  parseSearchCategory,
  parseSort,
  parseWithout,
  searchHref,
} from "@/lib/search-url";
import { isBotUserAgent } from "@/lib/guard/bots";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import { cachedSearchForBot, settledStream, startSearchForRequest } from "@/lib/search/server";
import { pageMetadata } from "@/lib/seo/page-meta";
import { RememberSearch } from "@/components/my-searches";
import { BotSearchNotice } from "./bot-notice";
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
        ? `${RESULTS_FIRST_VIEW} מוצרים מאלי אקספרס שעברו סינון לפי משוב של קונים ומספר מכירות, לחיפוש ״${q}״.`
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
  // A recent-search card or an example query: searched and listed as usual, logged as its origin.
  const from = parseFrom(params.from);
  // The same, plus an ad or campaign landing (utm_source, gclid): logged as search_log.origin.
  const arrival = parseArrival(params);
  // Limited to a category (a /products category page's search box); an unknown id is ignored.
  const cat = parseSearchCategory(params.cat);
  const href = searchHref({ q, sort, without, from, cat });
  const requestHeaders = await headers();

  // A crawler or script never starts paid work (lib/guard/bots.ts): the cached results when this
  // exact search is cached, otherwise a short page that points to the content pages. 200 and
  // noindex (generateMetadata) either way.
  if (isBotUserAgent(requestHeaders.get("user-agent"))) {
    const cached = await cachedSearchForBot({ q, without, sort, category: cat }, requestHeaders);
    if (!cached) return <BotSearchNotice query={q} />;
    const done = Promise.resolve({ ok: true as const, value: settledStream(cached) });
    const view = {
      understood: understoodSignal(done),
      ranked: rankedSignal(done),
      results: completeResults(done, { q, sort, without, cat, retryHref: href }),
    };
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
        <SearchComposer variant="bar" defaultValue={q} />
        <SearchView key={q} query={q} view={view} />
      </div>
    );
  }

  // One waiting screen, then the complete results at once (components/search-view.tsx). The page
  // itself never waits for the search: it starts it and passes its real moments as promises (the
  // chips once the query is understood, then that the products are ranked and their lines are
  // being written) with the finished results, rendered on the server once every line is written.
  // The results carry this request's search_log uid, which their buy buttons pass to /go.
  // SearchView is keyed by the query: another sort or a removed chip of the same query keeps the
  // results on screen, dimmed, until the next view is complete; a new query starts with the wait.
  const started = startSearchForRequest(
    { q, without, sort, arrival, category: cat },
    requestHeaders,
  );
  const view = {
    understood: understoodSignal(started),
    ranked: rankedSignal(started),
    results: completeResults(started, { q, sort, without, cat, retryHref: href }),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <SearchComposer variant="bar" defaultValue={q} />
      <PendingNavigation>
        <SearchView key={q} query={q} view={view} />
      </PendingNavigation>
      {/* "החיפושים שלי": this query, in this browser only (components/my-searches.tsx). */}
      <RememberSearch query={q} />
    </div>
  );
}
