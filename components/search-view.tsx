"use client";

import { LoaderCircle } from "lucide-react";
import { Suspense, startTransition, use, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigationPending } from "./pending-navigation";
import { SearchWait } from "./search-wait/search-wait";
import { onSettled, type SearchSignals } from "./search-wait/signals";

// The results area of /search (app/search/page.tsx). One general waiting screen, then the complete
// results at once: the server page passes the search's real moments as promises (the chips once
// the query is understood, the products once ranked) and the results, rendered on the server once
// every line is written (or the lines built from the data, when that step failed). Nothing inside
// the results waits for anything, so the cards never show a placeholder.
//
// Another view of the same query (a sort change, a removed chip) arrives as new promises: the
// results on screen stay, dimmed and busy, with a small "מעדכנים…" note centered over them, until
// the next view is complete, and are then replaced in one step. A view whose products are not
// ranked within SLOW_UPDATE_MS of the click is a new AliExpress fetch: the waiting screen takes the
// results' place instead, with its real moments. A new query is a new instance (keyed by the query
// on the page), which starts with the waiting screen.

/** An update whose products are not ranked this long after the click fetches anew: the wait shows. */
export const SLOW_UPDATE_MS = 700;

export interface SearchViewData extends SearchSignals {
  /** The complete results, or the failure state, rendered on the server; never rejects. */
  results: Promise<ReactNode>;
}

function Results({ promise }: { promise: Promise<ReactNode> }) {
  return use(promise);
}

/** Says when the results of `view` are on screen (it renders only once they are). */
function Shown({
  view,
  onShown,
}: {
  view: SearchViewData;
  onShown: (view: SearchViewData) => void;
}) {
  useEffect(() => onShown(view), [view, onShown]);
  return null;
}

/**
 * "מעדכנים…" over the results while the next view is prepared, in the middle of the screen as long
 * as the results reach it. It says so once (role status), and once more when the page knows the
 * lines of the next view are being written. It fades in after a moment, so a quick update barely
 * shows it.
 */
function UpdatingNote({ next }: { next: SearchSignals | null }) {
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (!next) return;
    let live = true;
    onSettled(next.ranked, (ranked) => {
      if (live && ranked?.writing) setWriting(true);
    });
    return () => {
      live = false;
    };
  }, [next]);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="sticky top-[42dvh] flex justify-center px-4 pt-6">
        <p
          role="status"
          className="flex items-center gap-2.5 rounded-full border border-line bg-surface px-5 py-3 text-[15px] font-semibold text-ink shadow-soft transition-opacity delay-150 duration-200 starting:opacity-0"
        >
          <LoaderCircle
            aria-hidden
            className="size-5 shrink-0 animate-spin text-accent-ink motion-reduce:animate-none"
          />
          {writing ? "כותבים לכם למה בחרנו…" : "מעדכנים…"}
        </p>
      </div>
    </div>
  );
}

export function SearchView({
  query,
  view,
  slots,
}: {
  query: string;
  view: SearchViewData;
  /** Results on a page, for the waiting scene (RESULTS_PER_PAGE by default). */
  slots?: number;
}) {
  // The view on screen, and the one arriving (a new sort or chip set of the same query).
  const [shown, setShown] = useState(view);
  // The view whose results are on screen (not its wait).
  const [complete, setComplete] = useState<SearchViewData | null>(null);
  const [slowFor, setSlowFor] = useState<SearchViewData | null>(null);
  const updateStart = useRef<number | null>(null);
  // While the wait still shows, a new view takes over at once: its wait follows the new view.
  if (view !== shown && complete !== shown) setShown(view);
  const incoming = view === shown ? null : view;
  const linkPending = useNavigationPending();
  const updating = linkPending || incoming !== null;

  useEffect(() => {
    if (!updating) updateStart.current = null;
    else updateStart.current ??= performance.now();
  }, [updating]);

  // The next view replaces the results on screen once it is complete, in one step.
  useEffect(() => {
    if (!incoming) return;
    let live = true;
    onSettled(incoming.results, () => {
      if (live) startTransition(() => setShown(incoming));
    });
    return () => {
      live = false;
    };
  }, [incoming]);

  // An update whose products are not ranked soon after the click fetches anew: the wait shows.
  useEffect(() => {
    if (!incoming) return;
    let ranked = false;
    onSettled(incoming.ranked, () => {
      ranked = true;
    });
    const since = updateStart.current ?? performance.now();
    const timer = window.setTimeout(
      () => {
        if (!ranked) setSlowFor(incoming);
      },
      Math.max(0, SLOW_UPDATE_MS - (performance.now() - since)),
    );
    return () => window.clearTimeout(timer);
  }, [incoming]);

  const slow = incoming !== null && slowFor === incoming;
  const waiting = complete !== shown;

  return (
    <>
      <div
        data-results-slot
        aria-busy={updating || undefined}
        className={slow ? "hidden" : "relative"}
      >
        <div
          className={
            updating
              ? "opacity-60 transition-opacity delay-100 duration-200 motion-reduce:transition-none"
              : undefined
          }
        >
          <Suspense fallback={null}>
            <Results promise={shown.results} />
            <Shown view={shown} onShown={setComplete} />
          </Suspense>
        </div>
        {updating && !waiting && !slow && <UpdatingNote next={incoming} />}
      </div>
      {/* Beside the results, not their Suspense fallback: a fallback streamed with the page is not
          hydrated before its content comes, so it could not follow the search's moments. The
          wait hides the moment the results are in the page (globals.css, before any script
          runs), and leaves once they are hydrated. */}
      {waiting && (
        <div data-search-wait>
          <SearchWait key={keyOf(shown)} query={query} signals={shown} slots={slots} />
        </div>
      )}
      {slow && <SearchWait key={keyOf(incoming)} query={query} signals={incoming} slots={slots} />}
    </>
  );
}

/** A key per view, so a wait never carries the state of another view's wait. */
const viewKeys = new WeakMap<object, number>();
let lastKey = 0;
function keyOf(view: object): number {
  let key = viewKeys.get(view);
  if (key === undefined) {
    key = ++lastKey;
    viewKeys.set(view, key);
  }
  return key;
}
