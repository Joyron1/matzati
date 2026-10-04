// The Meta Pixel through Meta's fbevents.js, for the pixel id the owner sets in /admin/settings.
// Strict, unlike Google Analytics: the loader (./meta-pixel.tsx) runs only inside
// <ConsentGate category="marketing">, so nothing reaches Meta before the visitor accepts marketing.
// createFbq takes its environment as an argument so it runs in unit tests; browserFbq binds it to
// the real window and document. The /go buy-click page (app/go/[productId]/respond.ts) uses the
// same source and settings.
//
// What it sends is kept small on purpose:
// - fbq.disablePushState and fbq.allowDuplicatePageViews are set before fbevents.js loads, so it
//   never sends page views of its own on history changes; ours are sent once per route change.
// - fbq('set', 'autoConfig', false, id) before init: no automatic button-click or page-metadata
//   events. init gets the id only: no advanced matching (no name, email or phone, ever).
// - fbevents.js always sends the whole page address (dl), so a page view is sent only where the
//   address holds nothing a visitor typed: not on /admin, /dev or /go, and only when every query
//   parameter is in META_ALLOWED_PARAMS (never the search text "q"). When the first page is not
//   allowed, fbevents.js is not even loaded until a page that is.
// - It also sends document.referrer (rl), which after a full page load from /search?q=… holds the
//   search text: before fbevents.js loads, document.referrer is shadowed with metaReferrer's
//   reduced value (other scripts on the page read the reduced value too).
// - Withdrawing consent (ConsentGate unmounts the loader) calls fbq('consent', 'revoke'), stops our
//   page views and deletes the _fbp and _fbc cookies; a page without consent deletes leftovers.
import { cookieDeletions } from "./gtag";

export const META_PIXEL_SRC = "https://connect.facebook.net/en_US/fbevents.js";

/** Query parameters a page may have and still be sent to Meta: none of them holds visitor text. */
export const META_ALLOWED_PARAMS: readonly string[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "from",
  "sort",
  "cat",
  "page",
  "lists",
];

/** Paths never sent to Meta: the owner's pages, development previews and the click-out route. */
const UNSENT_PREFIXES = ["/admin", "/dev", "/go"];

/** The first-party cookies fbevents.js writes (_fbc only after a click with fbclid). */
export const META_COOKIES: readonly string[] = ["_fbp", "_fbc"];

/**
 * Whether a page view may be sent for this page: not on /admin, /dev or /go, and every query
 * parameter in META_ALLOWED_PARAMS. `search` is the query string, with or without its "?".
 */
export function metaPageAllowed(pathname: string, search: string): boolean {
  if (UNSENT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of params.keys()) {
    if (!META_ALLOWED_PARAMS.includes(key)) return false;
  }
  return true;
}

/**
 * The referrer fbevents.js may read: a page of this site as it is when metaPageAllowed, else its
 * path only; another site's address reduced to its origin and path. "" when there is none.
 */
export function metaReferrer(referrer: string, origin: string): string {
  if (!referrer) return "";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "";
  }
  if (url.origin === origin && metaPageAllowed(url.pathname, url.search)) {
    return `${url.origin}${url.pathname}${url.search}`;
  }
  return `${url.origin}${url.pathname}`;
}

/** Names of the Meta cookies present in a `document.cookie` string. */
export function metaCookieNames(cookies: string): string[] {
  const names = cookies
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => META_COOKIES.includes(name));
  return [...new Set(names)];
}

/** The `document.cookie` assignments that delete every Meta cookie present (and parent domains). */
export function metaCookieDeletions(cookies: string, hostname: string): string[] {
  return metaCookieNames(cookies).flatMap((name) => cookieDeletions(name, hostname));
}

/** What the page gives the controller. */
export interface FbqEnv {
  /** Where fbq and _fbq live (window). */
  win: Record<string, unknown>;
  /** Adds <script async src> to the page. */
  appendScript(src: string): void;
  /** Shadows document.referrer with the reduced value (metaReferrer), before the script loads. */
  maskReferrer(): void;
  /** The `document.cookie` string. */
  readCookies(): string;
  /** One `document.cookie` assignment. */
  writeCookie(cookie: string): void;
  /** The page's host name, for deleting cookies set on a parent domain. */
  hostname(): string;
}

export type FbqState = "idle" | "on" | "revoked";

export interface FbqController {
  readonly state: FbqState;
  /**
   * One PageView for `route` (path and query as the router sees them) when `allowed`
   * (metaPageAllowed). Loads fbevents.js on the first allowed page, grants again after revoke().
   * Once per route. Returns whether it was sent.
   */
  pageView(route: string, allowed: boolean): boolean;
  /** Consent withdrawn: fbq('consent', 'revoke'), no more page views, the cookies deleted. */
  revoke(): void;
  /** Deletes the _fbp and _fbc cookies (host-only and every parent domain). */
  clearCookies(): void;
}

type Fbq = ((...args: unknown[]) => void) & Record<string, unknown>;

/**
 * Meta's queue stub (the base code's), with our settings on it before fbevents.js arrives. The
 * same lines, as a string, run on the /go buy-click page (pixelStubScript).
 */
function installStub(win: Record<string, unknown>): Fbq {
  if (typeof win.fbq === "function") return win.fbq as Fbq;
  const n = function fbq(...args: unknown[]) {
    if (typeof n.callMethod === "function") {
      (n.callMethod as (...a: unknown[]) => void)(...args);
    } else {
      (n.queue as unknown[]).push(args);
    }
  } as Fbq;
  win.fbq = n;
  if (!win._fbq) win._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  n.disablePushState = true;
  n.allowDuplicatePageViews = true;
  return n;
}

export function createFbq(pixelId: string, env: FbqEnv): FbqController {
  let state: FbqState = "idle";
  let lastRoute: string | null = null;
  let fbq: Fbq | null = null;

  function clearCookies() {
    for (const cookie of metaCookieDeletions(env.readCookies(), env.hostname())) {
      env.writeCookie(cookie);
    }
  }

  function load() {
    fbq = installStub(env.win);
    env.maskReferrer();
    fbq("set", "autoConfig", false, pixelId);
    fbq("init", pixelId);
    env.appendScript(META_PIXEL_SRC);
  }

  return {
    get state() {
      return state;
    },
    pageView(route, allowed) {
      if (!allowed) return false;
      if (state === "idle") load();
      else if (state === "revoked") fbq?.("consent", "grant");
      state = "on";
      if (route === lastRoute) return false;
      lastRoute = route;
      fbq?.("track", "PageView");
      return true;
    },
    revoke() {
      if (state === "on") {
        fbq?.("consent", "revoke");
        state = "revoked";
      }
      clearCookies();
    },
    clearCookies,
  };
}

const controllers = new Map<string, FbqController>();

/** The page's controller for a pixel id. Browser only (effects and event handlers). */
export function browserFbq(pixelId: string): FbqController {
  let controller = controllers.get(pixelId);
  if (!controller) {
    controller = createFbq(pixelId, {
      win: window as unknown as Record<string, unknown>,
      appendScript: (src) => {
        const script = document.createElement("script");
        script.async = true;
        script.src = src;
        document.head.appendChild(script);
      },
      maskReferrer: () => {
        const reduced = metaReferrer(document.referrer, window.location.origin);
        try {
          Object.defineProperty(document, "referrer", { configurable: true, get: () => reduced });
        } catch {
          // Not redefinable here: nothing better to do than not loading at all.
        }
      },
      readCookies: () => document.cookie,
      writeCookie: (cookie) => {
        document.cookie = cookie;
      },
      hostname: () => window.location.hostname,
    });
    controllers.set(pixelId, controller);
  }
  return controller;
}

/** A value as a JavaScript literal that is safe inside an inline <script> element. */
export function scriptLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * The inline script of the /go buy-click page: the same stub and settings as installStub and load
 * (referrer emptied: the page before /go is often /search?q=…), the InitiateCheckout event with
 * the product id only, then location.replace(affiliateUrl) once fbevents.js has loaded and had a
 * moment to send, or after `maxWaitMs` at most, or at once on any error.
 */
export function buyClickScript({
  pixelId,
  productId,
  affiliateUrl,
  maxWaitMs = 800,
}: {
  pixelId: string;
  productId: string;
  affiliateUrl: string;
  maxWaitMs?: number;
}): string {
  return `(function(){
var url=${scriptLiteral(affiliateUrl)},id=${scriptLiteral(pixelId)},pid=${scriptLiteral(productId)};
var done=false;function go(){if(done)return;done=true;location.replace(url);}
setTimeout(go,${Math.max(0, Math.round(maxWaitMs))});
try{
try{Object.defineProperty(document,"referrer",{configurable:true,get:function(){return "";}});}catch(e){}
var n=window.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments);};
if(!window._fbq)window._fbq=n;n.push=n;n.loaded=true;n.version="2.0";n.queue=[];
n.disablePushState=true;n.allowDuplicatePageViews=true;
n("set","autoConfig",false,id);n("init",id);
n("track","InitiateCheckout",{content_ids:[pid],content_type:"product"});
var s=document.createElement("script");s.async=true;s.src=${scriptLiteral(META_PIXEL_SRC)};
s.onload=function(){setTimeout(go,250);};s.onerror=go;
document.head.appendChild(s);
}catch(e){go();}
})();`;
}
