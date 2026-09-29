"use client";

// Vercel Web Analytics (owner request 2026-09-29): cookieless page views, no personal identifiers
// (Vercel counts visitors with a daily-rotating hash it never stores). Addresses reach Vercel
// without their query string, so the search text (?q=) and every other parameter stay on the
// site; admin and dev pages are not counted at all. Described on /privacy.
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

const NOT_COUNTED = /^\/(admin|dev)(\/|$)/;

/** The event with its URL cut to origin + path, or null for pages that are not counted. */
export function stripEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (NOT_COUNTED.test(url.pathname)) return null;
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}

export function VercelAnalytics() {
  return <Analytics beforeSend={stripEvent} />;
}
