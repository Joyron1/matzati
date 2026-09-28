"use client";

import type { ReactNode } from "react";
import { consentAllows, type OptionalCategory } from "@/lib/consent/consent";
import { useConsent } from "@/lib/consent/use-consent";

/**
 * Renders its children only once the visitor has accepted `category`: never in the server HTML,
 * never before the cookie is read, and not after a "necessary only" choice. Wrap any future
 * analytics or marketing script in it (and bump CONSENT_VERSION in lib/consent/consent.ts, so
 * everyone is asked again). It follows the choice without a reload: a withdrawal unmounts the
 * children, but a script that already ran may need its own opt-out call as well.
 */
export function ConsentGate({
  category,
  children,
}: {
  category: OptionalCategory;
  children?: ReactNode;
}) {
  const { consent } = useConsent();
  return consentAllows(consent, category) ? children : null;
}
