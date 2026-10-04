"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { BRAND } from "@/lib/config/brand";
import { consentAllows, consentNotice } from "@/lib/consent/consent";
import { useConsent } from "@/lib/consent/use-consent";
import {
  analyticsLocation,
  analyticsReferrer,
  analyticsTitle,
  browserGtag,
  isTrackedPath,
  type AnalyticsPage,
} from "./gtag";

/** How long a page view waits for the new page's title after a client navigation. */
const TITLE_WAIT_MS = 1000;

/** The page view parameters for the page the router shows now. */
function currentPage(route: string): AnalyticsPage | null {
  const href = `${window.location.origin}${route}`;
  const location = analyticsLocation(href);
  if (!location) return null;
  const referrer = analyticsReferrer(document.referrer, window.location.origin);
  return {
    page_location: location,
    page_title: analyticsTitle(href, document.title, BRAND.name),
    ...(referrer ? { page_referrer: referrer } : {}),
  };
}

/**
 * Calls `send` once the document has a title other than `previous` (the new page's metadata may
 * land a moment after its content, and the title is empty in between), or after TITLE_WAIT_MS.
 * At once when there is no previous title. Returns a cancel function.
 */
function afterTitleChange(previous: string | null, send: () => void): () => void {
  const changed = () => document.title !== "" && document.title !== previous;
  if (previous === null || changed()) {
    send();
    return () => {};
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
    send();
  };
  const observer = new MutationObserver(() => {
    if (changed()) finish();
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  const timer = setTimeout(finish, TITLE_WAIT_MS);
  return () => {
    done = true;
    observer.disconnect();
    clearTimeout(timer);
  };
}

/**
 * Mounted once the visitor's choice is known (in the browser, after hydration): sets the consent
 * state, loads gtag.js on a measured page (all consent denied first; analytics_storage granted
 * only with the visitor's consent), and sends one reduced page view per route change, with or
 * without consent. Nothing on /admin or /dev.
 */
function GtagTracker({ measurementId, granted }: { measurementId: string; granted: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = search ? `${pathname}?${search}` : pathname;
  const tracked = isTrackedPath(pathname);
  // The raw document title at the last page view, to notice when the next page's title is in.
  const lastTitle = useRef<string | null>(null);

  // Declared first, so the consent state is known before the load below: a visitor who accepted
  // earlier is granted before gtag.js arrives. A change later (accept, withdraw) updates
  // analytics_storage; without consent the _ga cookies are deleted.
  useEffect(() => {
    browserGtag(measurementId).consent(granted);
  }, [measurementId, granted]);

  // Before the page view below. start() does nothing while already on; the route only feeds the
  // first load's config.
  useEffect(() => {
    const gtag = browserGtag(measurementId);
    if (!tracked) {
      gtag.pause();
      return;
    }
    const page = currentPage(route);
    if (page) gtag.start(page);
  }, [measurementId, tracked, route]);

  useEffect(() => {
    if (!tracked) return;
    return afterTitleChange(lastTitle.current, () => {
      const page = currentPage(route);
      if (page && browserGtag(measurementId).pageView(route, page)) {
        lastTitle.current = document.title;
      }
    });
  }, [measurementId, tracked, route]);

  return null;
}

/**
 * Google Analytics 4 for the id the owner set in /admin/settings, in Consent Mode "advanced"
 * (owner decision 2026-10-03; the one exception to the ConsentGate rule besides Vercel Web
 * Analytics, CLAUDE.md §9): the root layout renders it only while an id is set, and it loads
 * gtag.js for every visitor with all consent denied, so Google gets cookieless pings with the
 * reduced address and no identifier. Only a visitor who accepts "סטטיסטיקה" under the notice that
 * describes this (consentNotice(true, marketingInUse): ANALYTICS_NOTICE, or
 * ANALYTICS_MARKETING_NOTICE while the Meta Pixel is configured too) gets analytics_storage granted
 * and the _ga cookies. Renders no HTML, and nothing before the browser has read the consent cookie.
 */
export function GoogleAnalytics({
  measurementId,
  marketingInUse,
}: {
  measurementId: string;
  marketingInUse: boolean;
}) {
  const { consent } = useConsent(consentNotice(true, marketingInUse));
  // Unknown on the server and during hydration: nothing until the cookie is read, so a visitor
  // who accepted is granted before gtag.js loads, never after a first denied page view.
  if (consent === undefined) return null;
  return (
    // useSearchParams: rendered in the browser only (above), the boundary keeps it local.
    <Suspense fallback={null}>
      <GtagTracker measurementId={measurementId} granted={consentAllows(consent, "analytics")} />
    </Suspense>
  );
}
