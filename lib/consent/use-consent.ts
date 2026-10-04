"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  BASE_NOTICE,
  consentAllows,
  type ConsentCategory,
  type ConsentNotice,
  type ConsentState,
} from "./consent";
import { consentStore, openConsentSettings } from "./store";

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

/**
 * The visitor's cookie choice under the notice the page shows (BASE_NOTICE, or the notice for the
 * optional tools the owner has configured: see consentNotice). Pass one of consentNotice's
 * constants: the store and the subscription key on it. Updates when it changes, without a reload.
 */
export function useConsent(notice: ConsentNotice = BASE_NOTICE): UseConsent {
  // The store is created on first use in the browser (it binds document and window).
  const subscribe = useCallback(
    (listener: () => void) => consentStore(notice).subscribe(listener),
    [notice],
  );
  const getSnapshot = useCallback(() => consentStore(notice).getSnapshot(), [notice]);
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
