import { Suspense } from "react";
import { SearchComposer } from "@/components/search-composer";
import { SearchBarFromUrl } from "@/components/search-wait/search-wait";

// Shown on a navigation from another page until the search page's frame arrives (it does not
// wait for the search), with the bar where the page's will be. The wait itself is the page's
// Suspense fallback, one per search, so it also shows for a search started from the results page
// (this file does not show again then) and does not restart when the frame replaces this file.
export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      {/* The query comes from the URL; the fallback only renders where it is not known yet. */}
      <Suspense fallback={<SearchComposer variant="bar" />}>
        <SearchBarFromUrl />
      </Suspense>
      {/* Keeps the footer below the fold until the wait takes this space. */}
      <div aria-hidden className="min-h-dvh" />
    </div>
  );
}
