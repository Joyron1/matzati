"use client";

import { openConsentSettings } from "@/lib/consent/store";

/**
 * "הגדרות עוגיות": reopens the cookie settings from any page. The footer's copy gets
 * COOKIE_SETTINGS_BUTTON_ID (ConsentManager moves focus there after a keyboard choice); other
 * copies (the /cookies page) go without an id, so it stays unique.
 */
export function CookieSettingsButton({ id, className }: { id?: string; className?: string }) {
  return (
    <button
      id={id}
      type="button"
      aria-haspopup="dialog"
      onClick={() => openConsentSettings()}
      className={className}
    >
      הגדרות עוגיות
    </button>
  );
}
