"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { ConsentGate } from "@/components/cookie-consent/consent-gate";
import { BRAND } from "@/lib/config/brand";
import { ANALYTICS_NOTICE, consentAllows } from "@/lib/consent/consent";
import { consentStore } from "@/lib/consent/store";
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
 * Mounted only while the visitor accepts statistics (ConsentGate): loads gtag.js on a measured
 * page, sends one page view per route change, and on unmount (consent withdrawn) tells Google to
 * stop and deletes the _ga cookies.
 */
function GtagTracker({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = search ? `${pathname}?${search}` : pathname;
  const tracked = isTrackedPath(pathname);
  // The raw document title at the last page view, to notice when the next page's title is in.
  const lastTitle = useRef<string | null>(null);

  // Declared first, so on a new page it runs before the page view below. grant() does nothing
  // while already on; the route only feeds the first load's config.
  useEffect(() => {
    const gtag = browserGtag(measurementId);
    if (!tracked) {
      gtag.pause();
      return;
    }
    const page = currentPage(route);
    if (page) gtag.grant(page);
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

  // Consent withdrawn (ConsentGate unmounts this): stop sending and delete the cookies. Checked
  // against the stored choice, so React's development-only remount does not count as one.
  useEffect(
    () => () => {
      if (!consentAllows(consentStore(ANALYTICS_NOTICE).getSnapshot(), "analytics")) {
        browserGtag(measurementId).revoke();
      }
    },
    [measurementId],
  );

  return null;
}

/**
 * Google Analytics 4 for the id the owner set in /admin/settings. The root layout renders it only
 * while an id is set; nothing loads before the visitor accepts "סטטיסטיקה" under the notice that
 * says Google Analytics is in use (ANALYTICS_NOTICE), and _ga cookies left from an earlier consent
 * are deleted while there is none.
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const { consent } = useConsent(ANALYTICS_NOTICE);
  const refused = consent !== undefined && !consentAllows(consent, "analytics");

  useEffect(() => {
    if (refused) browserGtag(measurementId).clearCookies();
  }, [refused, measurementId]);

  return (
    <ConsentGate category="analytics" notice={ANALYTICS_NOTICE}>
      {/* useSearchParams: rendered in the browser only (the gate), the boundary keeps it local. */}
      <Suspense fallback={null}>
        <GtagTracker measurementId={measurementId} />
      </Suspense>
    </ConsentGate>
  );
}
