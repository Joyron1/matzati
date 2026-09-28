"use client";

import type { ReactNode } from "react";
import {
  BASE_NOTICE,
  consentAllows,
  type ConsentNotice,
  type OptionalCategory,
} from "@/lib/consent/consent";
import { useConsent } from "@/lib/consent/use-consent";

/**
 * Renders its children only once the visitor has accepted `category`: never in the server HTML,
 * never before the cookie is read, and not after a "necessary only" choice. Wrap any analytics or
 * marketing script in it. `notice` is the cookie notice the page shows (consentNotice in
 * lib/consent/consent.ts): Google Analytics passes ANALYTICS_NOTICE, so only a choice made while
 * the banner said statistics are available counts. It follows the choice without a reload: a
 * withdrawal unmounts the children, but a script that already ran needs its own opt-out call as
 * well (components/analytics/google-analytics.tsx makes it on unmount).
 */
export function ConsentGate({
  category,
  notice = BASE_NOTICE,
  children,
}: {
  category: OptionalCategory;
  notice?: ConsentNotice;
  children?: ReactNode;
}) {
  const { consent } = useConsent(notice);
  return consentAllows(consent, category) ? children : null;
}
