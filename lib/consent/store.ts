// The browser side of cookie consent: reads and writes the consent cookie and tells the page when
// the choice changes or when the settings should open. createConsentStore takes its environment
// as arguments so it runs in unit tests; consentStore() binds it to the real document and window.
import {
  BASE_NOTICE,
  CONSENT_COOKIE,
  consentCookie,
  makeConsent,
  parseConsent,
  readCookie,
  sameChoice,
  type ConsentChoice,
  type ConsentNotice,
  type ConsentState,
} from "./consent";

/**
 * Fired on window after a choice is saved (detail: the ConsentState), so gated parts of the page
 * (ConsentGate, useConsent) update without a reload.
 */
export const CONSENT_CHANGE_EVENT = "matzati:consent-change";

/** Fired on window to open the cookie settings (the footer's "הגדרות עוגיות" button). */
export const CONSENT_OPEN_EVENT = "matzati:consent-open";

/**
 * The id of the footer's "הגדרות עוגיות" button: where keyboard focus goes after a choice made
 * with the keyboard takes the banner (and the pressed button) away. In a plain module, so the
 * footer (a server component) can read it.
 */
export const COOKIE_SETTINGS_BUTTON_ID = "cookie-settings";

export interface ConsentEnv {
  /** The `document.cookie` string. */
  readCookies(): string;
  /** One `document.cookie` assignment. */
  writeCookie(cookie: string): void;
  /** Whether the page is served over https (the cookie then gets Secure). */
  secure(): boolean;
  /** Where the events are dispatched and listened for (window). */
  target: EventTarget;
  now(): number;
}

export interface ConsentStore {
  /** For useSyncExternalStore: called after a save, and when the tab is shown again. */
  subscribe(listener: () => void): () => void;
  /** The current choice, or null when the visitor has not chosen (or it expired). Stable. */
  getSnapshot(): ConsentState | null;
  /** Stores a choice (under the current policy version) and notifies the page. */
  save(choice: ConsentChoice): ConsentState;
}

/**
 * Re-read the cookie when the tab is shown again or restored from the back/forward cache: the
 * visitor may have chosen in another tab meanwhile.
 */
const RECHECK_EVENTS = ["visibilitychange", "pageshow"] as const;

/**
 * `notice` is the cookie notice the page shows (./consent.ts consentNotice): which stored versions
 * count as a choice, and the version a new choice is stored with.
 */
export function createConsentStore(
  env: ConsentEnv,
  notice: ConsentNotice = BASE_NOTICE,
): ConsentStore {
  let read = false;
  let lastRaw: string | undefined;
  let lastState: ConsentState | null = null;
  // A choice the browser would not store (cookies blocked): honored for this page view only, so
  // the banner does not stay up after the visitor has chosen.
  let unsaved: ConsentState | null = null;

  function cookieValue(): string | undefined {
    try {
      return readCookie(env.readCookies(), CONSENT_COOKIE);
    } catch {
      return undefined; // document.cookie throws in a sandboxed frame
    }
  }

  function getSnapshot(): ConsentState | null {
    const raw = cookieValue();
    if (!read || raw !== lastRaw) {
      read = true;
      lastRaw = raw;
      lastState = parseConsent(raw, env.now(), notice);
    }
    return unsaved ?? lastState;
  }

  function subscribe(listener: () => void): () => void {
    env.target.addEventListener(CONSENT_CHANGE_EVENT, listener);
    for (const type of RECHECK_EVENTS) env.target.addEventListener(type, listener);
    return () => {
      env.target.removeEventListener(CONSENT_CHANGE_EVENT, listener);
      for (const type of RECHECK_EVENTS) env.target.removeEventListener(type, listener);
    };
  }

  function save(choice: ConsentChoice): ConsentState {
    const state = makeConsent(choice, env.now(), notice.version);
    try {
      env.writeCookie(consentCookie(state, { secure: env.secure() }));
    } catch {
      // Blocked: handled by the read-back below.
    }
    const stored = parseConsent(cookieValue(), env.now(), notice);
    unsaved = stored && stored.ts === state.ts && sameChoice(stored, state) ? null : state;
    env.target.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: state }));
    return state;
  }

  return { subscribe, getSnapshot, save };
}

/** One store per notice version (a page uses one notice; the map only keeps them apart). */
const browserStores = new Map<number, ConsentStore>();

/**
 * The page's store for the notice it shows. Browser only (call it from event handlers, effects
 * or store callbacks). Every store reads the same cookie and hears every save.
 */
export function consentStore(notice: ConsentNotice = BASE_NOTICE): ConsentStore {
  let store = browserStores.get(notice.version);
  if (!store) {
    store = createConsentStore(
      {
        readCookies: () => document.cookie,
        writeCookie: (cookie) => {
          document.cookie = cookie;
        },
        secure: () => window.location.protocol === "https:",
        target: window,
        now: () => Date.now(),
      },
      notice,
    );
    browserStores.set(notice.version, store);
  }
  return store;
}

/** Opens the cookie settings dialog from anywhere on the page (ConsentManager listens). */
export function openConsentSettings(target: EventTarget = window): void {
  target.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}
