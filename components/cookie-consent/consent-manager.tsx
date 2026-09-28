"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LEGAL_PATHS } from "@/lib/config/legal";
import type { ConsentChoice } from "@/lib/consent/consent";
import {
  CONSENT_OPEN_EVENT,
  COOKIE_SETTINGS_BUTTON_ID,
  consentStore,
  openConsentSettings,
} from "@/lib/consent/store";
import { useConsent } from "@/lib/consent/use-consent";
import { CookieBanner } from "./cookie-banner";
import { CookieSettingsDialog } from "./cookie-settings-dialog";

const BANNER_NOTICE = "בתחתית הדף יש הודעה על עוגיות.";
const SAVED_NOTICE = "הבחירה נשמרה.";

/** Whether focus is on a control the visitor reached with the keyboard. */
function keyboardFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.matches(":focus-visible");
}

/**
 * After a keyboard choice: when the focused control went away with the banner, focus has fallen
 * to <body> and the next Tab would leave the page. Continue at the footer's "הגדרות עוגיות"
 * (where the choice can be changed; it comes right before the banner in the page order). Only
 * for the keyboard: a mouse user's Space would then press that button instead of scrolling.
 */
function recoverLostFocus() {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  document.getElementById(COOKIE_SETTINGS_BUTTON_ID)?.focus();
}

/**
 * Starts keyboard users at the content of the page they just reached: focuses <main> (the skip
 * link's target) without scrolling, with a tabindex for this visit only (as InPageLink does).
 * Leaves focus alone when it is already inside <main> (HashTargetFocus put it on a section).
 */
function focusMain() {
  const main = document.getElementById("main");
  if (!main || main.contains(document.activeElement)) return;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
  }
  main.focus({ preventScroll: true });
}

/**
 * Cookie consent on every page (mounted once, last in the root layout). The server renders only
 * an empty live region: the banner appears after the cookie is read in the browser, and only
 * when there is no valid choice, so a returning visitor never sees it flash. The settings dialog
 * opens from the banner or from anywhere through openConsentSettings() (the footer button).
 */
export function ConsentManager() {
  const { consent } = useConsent();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bannerNotice, setBannerNotice] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  // The path the settings dialog was opened on.
  const openedOn = useRef<string | null>(null);
  // Set when the dialog's "למדיניות העוגיות המלאה" link is followed in this tab: the page is about
  // to change, so focus goes to the next page's content, not back to the opener.
  const leaving = useRef(false);
  // Set by a choice made with the keyboard, until focus is put back (recoverLostFocus).
  const keyboardChoice = useRef(false);
  const announced = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showBanner = consent === null;

  useEffect(() => {
    function onOpen() {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      openedOn.current = window.location.pathname;
      setSettingsOpen(true);
    }
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
      clearTimeout(savedTimer.current);
    };
  }, []);

  // Screen readers hear once per page load, politely, that the banner is there: it sits at the
  // end of the page. The delay lets the page's own announcements go first.
  useEffect(() => {
    if (!showBanner || announced.current) return;
    const timer = setTimeout(() => {
      announced.current = true;
      setBannerNotice(BANNER_NOTICE);
    }, 1000);
    return () => clearTimeout(timer);
  }, [showBanner]);

  // The banner has just gone after a keyboard choice made in it (or in the settings opened from
  // it, which closed before this commit): put focus back on the page.
  useEffect(() => {
    if (showBanner || !keyboardChoice.current) return;
    keyboardChoice.current = false;
    recoverLostFocus();
  }, [showBanner]);

  // The page the dialog's policy link led to has rendered. The browser put focus back on the
  // dialog's opener when it closed (in the previous page's footer, which stays): start at the
  // content instead.
  useEffect(() => {
    if (!leaving.current) return;
    leaving.current = false;
    focusMain();
  }, [pathname]);

  function choose(choice: ConsentChoice) {
    keyboardChoice.current = keyboardFocused();
    consentStore().save(choice);
    // The banner (and the button just pressed) goes away: confirm the choice to screen readers.
    setSavedNotice(SAVED_NOTICE);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedNotice(""), 5000);
  }

  function onSettingsClosed() {
    setSettingsOpen(false);
    const target = opener.current;
    opener.current = null;
    const openedOnPath = openedOn.current;
    openedOn.current = null;
    // The policy link followed on /cookies itself leaves the page as it is: close as usual.
    if (leaving.current && openedOnPath === LEGAL_PATHS.cookies) leaving.current = false;
    // Closed by the policy link (or the page changed while it was open): focusing the opener
    // would scroll this page to its footer on the way out. The effect on pathname takes over.
    if (leaving.current || window.location.pathname !== openedOnPath) {
      keyboardChoice.current = false;
      return;
    }
    // The browser restores focus as well; this covers browsers that do not. When the opener is
    // gone (the banner's "הגדרות" after a choice), a keyboard user continues at the footer.
    if (target?.isConnected) target.focus();
    else if (keyboardChoice.current) recoverLostFocus();
    keyboardChoice.current = false;
  }

  return (
    <>
      <div role="status" className="sr-only">
        {savedNotice || (showBanner ? bannerNotice : "")}
      </div>
      {showBanner && (
        <CookieBanner onChoose={choose} onOpenSettings={() => openConsentSettings()} />
      )}
      <CookieSettingsDialog
        open={settingsOpen}
        consent={consent}
        onSave={choose}
        onLeave={() => {
          leaving.current = true;
        }}
        onClose={onSettingsClosed}
      />
    </>
  );
}
