"use client";

import { useSyncExternalStore } from "react";
import { consentAllows, type ConsentCategory, type ConsentState } from "./consent";
import { consentStore, openConsentSettings } from "./store";

const subscribe = (listener: () => void) => consentStore().subscribe(listener);
const getSnapshot = () => consentStore().getSnapshot();
// The server has no cookie to read (the root layout never calls cookies(), so pages stay
// static): "unknown" until the browser has read it, which keeps the banner and every gated part
// out of the server HTML and out of hydration.
const getServerSnapshot = (): undefined => undefined;

export interface UseConsent {
  /**
   * The visitor's choice: undefined while unknown (server render and hydration), null when there
   * is none yet (the banner is showing), otherwise the stored choice.
   */
  consent: ConsentState | null | undefined;
  /** Whether a category may run now. Optional categories are off until consent is known. */
  allows(category: ConsentCategory): boolean;
  /** Opens the cookie settings dialog. */
  openSettings(): void;
}

/** The visitor's cookie choice. Updates when it changes, without a reload. */
export function useConsent(): UseConsent {
  const consent = useSyncExternalStore<ConsentState | null | undefined>(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return {
    consent,
    allows: (category) => consentAllows(consent, category),
    openSettings: () => openConsentSettings(),
  };
}
