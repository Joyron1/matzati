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

// A sort change or a removed filter on /search (app/search/page.tsx) is a navigation to the same
// search with other chips: the link that started it shows a small dot, and the results on screen
// stay, dimmed and busy with a small "מעדכנים…" note, until the next view is complete
// (components/search-view.tsx, which also decides when a slower one shows the wait instead).

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

/** True while a link of the results page is navigating (before the next page commits). */
export function useNavigationPending(): boolean {
  return useContext(StateContext).pending;
}

/**
 * Inside a Link of the results page (the Link must be `relative`): a small dot at its corner once
 * the navigation it started runs past 100 ms, and the page's pending state (useNavigationPending)
 * while it runs. Always rendered, fixed size and placed over the corner, so nothing moves; only its
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
