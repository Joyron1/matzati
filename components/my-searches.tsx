"use client";

// "החיפושים שלי" (owner request 2026-10-03): the visitor's own last searches, from this browser only
// (lib/recent/mine.ts, localStorage). Never sent to the server, so the server renders nothing and
// the chips appear once the page has hydrated; with no stored search nothing renders at all (no
// reserved room). A chip opens the search again (from=recent: logged like a recent-search card);
// its × forgets it, and "ניקוי" forgets them all. RememberSearch writes the list on /search.
import Link from "next/link";
import { History, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import {
  clearMySearches,
  forgetMySearch,
  MY_SEARCHES_EVENT,
  MY_SEARCHES_KEY,
  mySearchKey,
  parseMySearches,
  rememberMySearch,
} from "@/lib/recent/mine";
import { searchHref } from "@/lib/search-url";
import { scrollFocusedItemIntoView } from "./focus-scroll-list";

function subscribe(onChange: () => void): () => void {
  // Another tab changes the list ("storage"), or this page does (MY_SEARCHES_EVENT).
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === MY_SEARCHES_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(MY_SEARCHES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MY_SEARCHES_EVENT, onChange);
  };
}

/** The stored text (a stable snapshot: a string compares by value). Null while server-rendering. */
function storedText(): string | null {
  try {
    return window.localStorage.getItem(MY_SEARCHES_KEY);
  } catch {
    return null; // private mode or blocked site data
  }
}

const serverText = () => null;

/** Remembers the query of the results page it is on. Renders nothing. */
export function RememberSearch({ query }: { query: string }) {
  useEffect(() => {
    rememberMySearch(query);
  }, [query]);
  return null;
}

const CHIP =
  "inline-flex min-h-11 max-w-full items-center rounded-full border border-line bg-surface text-sm text-ink";
const CHIP_LINK =
  "inline-flex min-h-11 min-w-0 items-center rounded-full ps-4 pe-1 font-medium hover:text-accent-ink";
const REMOVE =
  "grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink";
const CLEAR =
  "inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent-ink underline-offset-4 hover:underline";
/** Chips under the home composer; the rest are on /searches. */
const HOME_LIMIT = 6;

/**
 * The visitor's searches as chips, newest first. "home": the newest HOME_LIMIT under the composer,
 * one row that swipes on phones and wraps from sm. "page" (/searches): a section of its own with
 * every kept search, wrapping.
 */
export function MySearches({ variant }: { variant: "home" | "page" }) {
  const text = useSyncExternalStore(subscribe, storedText, serverText);
  const searches = useMemo(() => parseMySearches(text), [text]);
  const titleId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  if (searches.length === 0) return null;
  const home = variant === "home";
  // The home page shows the newest few; /searches shows every one kept.
  const shown = home ? searches.slice(0, HOME_LIMIT) : searches;

  /** Focus after a chip is removed: the next chip, else the one before, else the search box. */
  const focusAfterRemoval = (index: number) => {
    requestAnimationFrame(() => {
      const links = listRef.current?.querySelectorAll<HTMLElement>("a");
      const next = links?.[Math.min(index, (links?.length ?? 1) - 1)];
      (next ?? searchBoxOrMain())?.focus();
    });
  };

  const remove = (q: string, index: number) => {
    forgetMySearch(q);
    focusAfterRemoval(index);
  };

  const clear = () => {
    clearMySearches();
    requestAnimationFrame(() => searchBoxOrMain()?.focus());
  };

  return (
    <section
      aria-labelledby={titleId}
      className={home ? "mt-4 text-start" : "space-y-3"}
      data-testid="my-searches"
    >
      <div
        className={`flex items-center gap-2 ${home ? "justify-between px-1" : "justify-between"}`}
      >
        {home ? (
          <h2 id={titleId} className="flex items-center gap-1.5 text-sm font-semibold text-muted">
            <History aria-hidden className="size-4" />
            החיפושים שלי
          </h2>
        ) : (
          <h2 id={titleId} className="flex items-center gap-2 font-display text-2xl text-ink">
            <History aria-hidden className="size-6 text-accent-ink" />
            החיפושים שלי
          </h2>
        )}
        <button type="button" onClick={clear} className={CLEAR} aria-label="ניקוי החיפושים שלי">
          ניקוי
        </button>
      </div>
      {!home && (
        <p className="text-sm text-pretty text-muted">
          החיפושים שעשיתם בדפדפן הזה. הם נשמרים רק אצלכם, ואף אחד אחר לא רואה אותם.
        </p>
      )}
      <ul
        ref={listRef}
        onFocus={home ? scrollFocusedItemIntoView : undefined}
        className={
          home
            ? // One row that swipes on phones; wrapped from sm, where a mouse cannot swipe.
              "mt-1 flex gap-2 overflow-x-auto px-1 py-1 [scroll-padding-inline:0.25rem] sm:flex-wrap sm:overflow-visible"
            : "flex flex-wrap gap-2"
        }
      >
        {shown.map((s, i) => (
          <li key={mySearchKey(s.q)} className={home ? "shrink-0" : "max-w-full"}>
            <span className={CHIP}>
              <Link
                href={searchHref({ q: s.q, from: "recent" })}
                prefetch={false}
                className={CHIP_LINK}
              >
                <bdi className={`block truncate ${home ? "max-w-[14rem]" : "max-w-[18rem]"}`}>
                  {s.q}
                </bdi>
              </Link>
              <button
                type="button"
                onClick={() => remove(s.q, i)}
                className={REMOVE}
                aria-label={`הסרת ״${s.q}״ מהחיפושים שלי`}
              >
                <X aria-hidden className="size-4" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {searches.length > shown.length && (
        <Link href="/searches" prefetch={false} className={`${CLEAR} mt-1`}>
          לכל {searches.length} החיפושים שלי
        </Link>
      )}
    </section>
  );
}

function searchBoxOrMain(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('main input[name="q"]') ?? document.getElementById("main")
  );
}
