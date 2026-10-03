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
 * lib/consent/consent.ts). It follows the choice without a reload: a withdrawal unmounts the
 * children, but a script that already ran needs its own opt-out call as well. The documented
 * exceptions (CLAUDE.md §9) are Vercel Web Analytics and Google Analytics in Consent Mode
 * "advanced" (components/analytics/google-analytics.tsx), which loads for everyone with all
 * consent denied and follows useConsent(ANALYTICS_NOTICE) itself.
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
