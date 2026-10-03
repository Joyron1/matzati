// Google Analytics 4 through Google's gtag.js, for the measurement id the owner sets in
// /admin/settings, in Google Consent Mode v2 "advanced" (owner decision 2026-10-03): the loader
// (./google-analytics.tsx, NOT inside ConsentGate) loads gtag.js on every measured page for every
// visitor, with all consent denied first, so Google gets cookieless pings until the visitor
// accepts statistics; only then is analytics_storage granted and the _ga cookies written.
// createGtag takes its environment as an argument so it runs in unit tests; browserGtag binds it
// to the real window and document.
//
// What it sends is kept small on purpose:
// - Google Consent Mode v2: ad_storage, ad_user_data, ad_personalization and analytics_storage
//   default to denied before gtag.js is added; analytics_storage alone is granted, and only while
//   the visitor accepts statistics. The ad types stay denied forever, with ads data redaction, no
//   Google signals and no ad personalization. While analytics_storage is denied gtag.js reads and
//   writes no cookies (cookieless pings).
// - anonymize_ip (GA4 does not store IP addresses anyway), host-only cookies that last 2 years
//   from the last visit (as /cookies states), written by gtag.js only once storage is granted.
// - Page views are sent by this code, once per route change, before and after consent alike, with
//   the address reduced to its path and a short list of parameters that never hold what a visitor
//   typed (the search text "q" is dropped), and /search's title (which holds the query) replaced.
//   send_page_view is false, so gtag.js never sends its own with the full address. Nothing on
//   /admin or /dev: gtag.js is not added there, and after a client navigation there Google's own
//   opt-out flag (window["ga-disable-<id>"]) stops every hit.
// - Withdrawing consent updates analytics_storage back to denied (cookieless pings again) and
//   deletes the _ga cookies; so does a page without consent, for cookies left from before.

/** Google's documented opt-out flag: while true, gtag.js sends nothing for that id. */
export const gaDisableKey = (measurementId: string) => `ga-disable-${measurementId}`;

export const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

/** 2 years, the GA default, stated on /cookies. */
export const GA_COOKIE_SECONDS = 2 * 365 * 24 * 60 * 60;

/** Query parameters kept in the address sent to Google: none of them holds free text. */
export const KEPT_PARAMS: readonly string[] = [
  "cat",
  "price",
  "sort",
  "code",
  "video",
  "page",
  "from",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

/** Pages whose title holds what the visitor typed, and the title sent instead. */
const PLAIN_TITLES: Record<string, string> = {
  "/search": "חיפוש",
};

/** Paths that are never measured (the owner's pages and development previews). */
const UNTRACKED_PREFIXES = ["/admin", "/dev"];

/** Whether page views are sent on this path. */
export function isTrackedPath(pathname: string): boolean {
  return !UNTRACKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The event parameters of one page view. */
export interface AnalyticsPage {
  page_location: string;
  page_title: string;
  page_referrer?: string;
}

/** An address as sent to Google: the path and KEPT_PARAMS only, no fragment. */
export function analyticsLocation(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (KEPT_PARAMS.includes(key)) kept.append(key, value);
  }
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

/**
 * The title sent for a page: /search's is replaced (it holds the query), and any other title that
 * contains the value of a dropped parameter, or an empty one, is replaced by the path.
 */
export function analyticsTitle(href: string, title: string, brand: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return brand;
  }
  const plain = PLAIN_TITLES[url.pathname];
  if (plain) return `${plain} | ${brand}`;
  for (const [key, value] of url.searchParams) {
    const text = value.trim();
    if (!KEPT_PARAMS.includes(key) && text.length >= 2 && title.includes(text)) {
      return `${url.pathname} | ${brand}`;
    }
  }
  // No title yet (between two pages' metadata): the path rather than an empty one.
  return title.trim() || `${url.pathname} | ${brand}`;
}

/**
 * The referrer sent with the first page view: an address on this site goes through
 * analyticsLocation, another site's is reduced to its origin and path. Undefined when there is none.
 */
export function analyticsReferrer(referrer: string, origin: string): string | undefined {
  if (!referrer) return undefined;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return undefined;
  }
  if (url.origin === origin) return analyticsLocation(referrer) ?? undefined;
  return `${url.origin}${url.pathname}`;
}

/** What the page gives the controller. */
export interface GtagEnv {
  /** Where dataLayer, gtag and the opt-out flag live (window). */
  win: Record<string, unknown>;
  /** Adds <script async src> to the page. */
  appendScript(src: string): void;
  /** The `document.cookie` string. */
  readCookies(): string;
  /** One `document.cookie` assignment. */
  writeCookie(cookie: string): void;
  /** The page's host name, for deleting cookies set on a parent domain. */
  hostname(): string;
}

/** Names of the GA cookies in a `document.cookie` string: `_ga` and `_ga_<container>`. */
export function gaCookieNames(cookies: string): string[] {
  const names = cookies
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
  return [...new Set(names)];
}

/**
 * The assignments that delete cookie `name`: host-only (how this site's gtag sets them) and on
 * every parent domain of `hostname`, in case one was ever set there.
 */
export function cookieDeletions(name: string, hostname: string): string[] {
  const expire = `${name}=; Max-Age=0; Path=/`;
  const labels = hostname.split(".");
  const domains: string[] = [];
  // Not for an IP address or a single label (localhost): only host-only cookies exist there.
  if (labels.length > 1 && !/^[\d.]+$/.test(hostname)) {
    for (let i = 0; i < labels.length - 1; i++) domains.push(labels.slice(i).join("."));
  }
  return [expire, ...domains.map((d) => `${expire}; Domain=${d}`)];
}

export type GtagState = "idle" | "on" | "paused";

/** Consent Mode v2 defaults, set before gtag.js loads: everything denied. */
export const CONSENT_DEFAULTS = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
} as const;

/** The config for the measurement id (the page's address and title are added per page). */
export const GTAG_CONFIG = {
  // Our code sends every page view itself, reduced (pageView): never gtag.js's own.
  send_page_view: false,
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
  // Host-only cookies for 2 years: written by gtag.js only while analytics_storage is granted.
  cookie_domain: "none",
  cookie_expires: GA_COOKIE_SECONDS,
} as const;

export interface GtagController {
  readonly state: GtagState;
  /** Whether analytics_storage is granted (the visitor accepts statistics). */
  readonly granted: boolean;
  /**
   * The page is measured: loads gtag.js once (Consent Mode defaults all denied, then
   * analytics_storage granted only when consent() said so), or resumes after pause().
   */
  start(page: AnalyticsPage): void;
  /** A page that is not measured (/admin, /dev): nothing is sent until start() again. */
  pause(): void;
  /**
   * The visitor's statistics choice. Before the load it only decides the first update; after it,
   * a change updates analytics_storage. Not granted (no choice yet, refused or withdrawn) also
   * deletes the _ga cookies.
   */
  consent(granted: boolean): void;
  /** Deletes any _ga cookies. */
  clearCookies(): void;
  /**
   * One page view for `route` (the path and query as the router sees them), with or without
   * consent. Sent only while on, and once per route: the same route again sends nothing. Returns
   * whether it was sent.
   */
  pageView(route: string, page: AnalyticsPage): boolean;
}

export function createGtag(measurementId: string, env: GtagEnv): GtagController {
  let state: GtagState = "idle";
  let granted = false;
  let lastRoute: string | null = null;
  let lastLocation: string | null = null;
  const win = env.win;

  function gtag(...args: unknown[]) {
    (win.gtag as (...a: unknown[]) => void)(...args);
  }

  function setDisabled(disabled: boolean) {
    win[gaDisableKey(measurementId)] = disabled;
  }

  function clearCookies() {
    const host = env.hostname();
    for (const name of gaCookieNames(env.readCookies())) {
      for (const cookie of cookieDeletions(name, host)) env.writeCookie(cookie);
    }
  }

  function load(page: AnalyticsPage) {
    const dataLayer = (win.dataLayer ??= []) as unknown[];
    if (typeof win.gtag !== "function") {
      // Google's snippet: gtag.js reads Arguments objects from the data layer, not arrays.
      win.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        dataLayer.push(arguments);
      };
    }
    setDisabled(false);
    // Before anything else and before gtag.js is added: every consent type denied.
    gtag("consent", "default", { ...CONSENT_DEFAULTS });
    gtag("set", "ads_data_redaction", true);
    if (granted) gtag("consent", "update", { analytics_storage: "granted" });
    gtag("js", new Date());
    gtag("config", measurementId, { ...GTAG_CONFIG, ...page });
    env.appendScript(`${GTAG_SRC}?id=${encodeURIComponent(measurementId)}`);
  }

  return {
    get state() {
      return state;
    },
    get granted() {
      return granted;
    },
    start(page) {
      if (state === "on") return;
      if (state === "idle") load(page);
      else setDisabled(false);
      state = "on";
    },
    pause() {
      if (state !== "on") return;
      setDisabled(true);
      state = "paused";
    },
    consent(next) {
      if (state !== "idle" && next !== granted) {
        gtag("consent", "update", { analytics_storage: next ? "granted" : "denied" });
      }
      granted = next;
      // After the update, so gtag.js has stopped writing them.
      if (!next) clearCookies();
    },
    clearCookies,
    pageView(route, page) {
      if (state !== "on" || route === lastRoute) return false;
      lastRoute = route;
      // After the first, the referrer is the page before (as a full page load would give).
      const event: AnalyticsPage =
        lastLocation !== null && lastLocation !== page.page_location
          ? { ...page, page_referrer: lastLocation }
          : page;
      lastLocation = page.page_location;
      // Later events on this page (scrolls, clicks) carry the same reduced address and title.
      gtag("set", event);
      gtag("event", "page_view", event);
      return true;
    },
  };
}

const controllers = new Map<string, GtagController>();

/** The page's controller for a measurement id. Browser only (effects and event handlers). */
export function browserGtag(measurementId: string): GtagController {
  let controller = controllers.get(measurementId);
  if (!controller) {
    controller = createGtag(measurementId, {
      win: window as unknown as Record<string, unknown>,
      // gtag.js (about 150 KB of script) is added once the page has loaded and the browser is
      // idle: in advanced mode it loads for every visitor, and added at once it doubled the home
      // page's blocking time on a phone (Lighthouse 2026-10-03, TBT 60 → 255 ms). The commands
      // given before it arrives (consent defaults, config, page views) wait in dataLayer and are
      // sent when it runs, so nothing is lost.
      appendScript: (src) => {
        const add = () => {
          const script = document.createElement("script");
          script.async = true;
          script.src = src;
          document.head.appendChild(script);
        };
        const whenIdle = () => {
          // Safari before 18 has no requestIdleCallback (the DOM types say every browser does).
          const idle = (window as { requestIdleCallback?: Window["requestIdleCallback"] })
            .requestIdleCallback;
          if (idle) idle.call(window, add, { timeout: 4000 });
          else setTimeout(add, 1500);
        };
        if (document.readyState === "complete") whenIdle();
        else window.addEventListener("load", whenIdle, { once: true });
      },
      readCookies: () => document.cookie,
      writeCookie: (cookie) => {
        document.cookie = cookie;
      },
      hostname: () => window.location.hostname,
    });
    controllers.set(measurementId, controller);
  }
  return controller;
}
