"use client";

import { useLinkStatus } from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SearchWait } from "@/components/search-wait/search-wait";

// A sort change or a removed filter on /search (app/search/page.tsx) is a navigation to the same
// search with other chips: the results on screen stay while the next ones are prepared (a view of
// the checked pool, plan item 13, comes in well under a second), marked busy and dimmed; the
// link that started it shows a small dot. Only when it is still pending after SLOW_NAVIGATION_MS
// (a view that fetches from AliExpress again) does the wait take the results' place, from its
// AliExpress step: the query is understood, its chips are on screen.

/** After this long a pending view is a new fetch: the wait replaces the results on screen. */
export const SLOW_NAVIGATION_MS = 700;

interface PendingState {
  /** A link of the results page is navigating. */
  pending: boolean;
  /** Counts the navigations started, so a wait belongs to one of them. */
  generation: number;
}

/** Tells the page a link started navigating; returns the call that says it is done. */
const ReportContext = createContext<(() => () => void) | null>(null);
const StateContext = createContext<PendingState>({ pending: false, generation: 0 });

/** Around the results page: the pending state its links report (LinkPending). */
export function PendingNavigation({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PendingState>({ pending: false, generation: 0 });
  const running = useRef(0);
  const report = useCallback(() => {
    running.current++;
    if (running.current === 1) {
      setState((s) => ({ pending: true, generation: s.generation + 1 }));
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      running.current--;
      if (running.current === 0) setState((s) => ({ ...s, pending: false }));
    };
  }, []);
  return (
    <ReportContext.Provider value={report}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ReportContext.Provider>
  );
}

/**
 * The results area: busy and dimmed while a link of the page navigates, and replaced by the wait
 * (from the AliExpress step, the chips staying above) once that takes longer than
 * SLOW_NAVIGATION_MS. The results stay mounted meanwhile; the next ones replace them.
 */
export function PendingResults({ query, children }: { query: string; children: ReactNode }) {
  const { pending, generation } = useContext(StateContext);
  // The navigation whose wait is due; a later one starts its own delay.
  const [slowFor, setSlowFor] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlowFor(generation), SLOW_NAVIGATION_MS);
    return () => window.clearTimeout(timer);
  }, [pending, generation]);
  const slow = pending && slowFor === generation;
  return (
    <>
      <div
        aria-busy={pending || undefined}
        className={
          slow
            ? "hidden"
            : pending
              ? "space-y-6 opacity-60 transition-opacity delay-100 duration-200 motion-reduce:transition-none"
              : "space-y-6"
        }
      >
        {children}
      </div>
      {slow && <SearchWait query={query} understood waitKey={`pending:${generation}`} />}
    </>
  );
}

/**
 * Inside a Link of the results page (the Link must be `relative`): a small dot at its corner once
 * the navigation it started runs past 100 ms, and the page's pending state (PendingResults) while
 * it runs. Always rendered, fixed size and placed over the corner, so nothing moves; only its
 * opacity changes (the useLinkStatus guidance in node_modules/next/dist/docs).
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  const report = useContext(ReportContext);
  useEffect(() => (pending && report ? report() : undefined), [pending, report]);
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute -end-0.5 -top-0.5 size-3 rounded-full bg-accent ring-2 ring-bg transition-opacity motion-reduce:transition-none ${
        pending ? "opacity-100 delay-100 duration-200" : "opacity-0 duration-0"
      }`}
    />
  );
}

/**
 * Puts keyboard focus back after a navigation of the page removed the element that had it (a
 * removed chip, the sort bar of a view that had none): when `when` changes and focus is on
 * nothing, it goes to the first element inside this component's parent that matches the first of
 * `targets` any element matches. Never on the first render: a page load does not move focus.
 */
export function RestoreFocus({ when, targets }: { when: string; targets: readonly string[] }) {
  const marker = useRef<HTMLSpanElement>(null);
  const last = useRef(when);
  const selectors = targets.join("\n");
  useEffect(() => {
    if (last.current === when) return;
    last.current = when;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const box = marker.current?.parentElement;
    for (const selector of selectors.split("\n")) {
      const found = box?.querySelector<HTMLElement>(selector);
      if (found) {
        found.focus();
        return;
      }
    }
  }, [when, selectors]);
  return <span ref={marker} hidden />;
}
