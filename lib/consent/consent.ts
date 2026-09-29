// Cookie consent: the stored choice, the cookie that holds it and the pure rules around it.
// The browser side (reading and writing document.cookie, change events) is ./store.ts; the hook
// is ./use-consent.ts; the banner and settings dialog are components/cookie-consent/.
//
// The cookie is first-party and readable by page scripts (not httpOnly) on purpose: the choice
// gates optional scripts in the browser. No server code reads it, so pages stay static.
//
// No zod here: this module is in every page's browser bundle (the cookie banner), and zod was
// 70 KB of it (Lighthouse 2026-09-30). The stored shape is five fields, checked by hand below.

/** The first-party cookie that holds the visitor's choice. */
export const CONSENT_COOKIE = "matzati_consent";

/**
 * Version of the cookie notice. Bump it whenever the categories or what they cover change (for
 * example when an analytics or marketing tool is added, which also means updating
 * ./categories.ts and the /cookies page): a stored choice with any other version is ignored, so
 * every visitor is asked again.
 */
export const CONSENT_VERSION = 1;

/**
 * Added to CONSENT_VERSION while Google Analytics is configured (/admin/settings, "חיבור לגוגל"):
 * the banner then says statistics are available, so a choice made under the notice without it
 * (which said statistics were not in use) is not consent to it, and every visitor is asked again.
 */
export const ANALYTICS_NOTICE_OFFSET = 1000;

/** The notice a page shows: the version it stores with a new choice and the ones it honors. */
export interface ConsentNotice {
  /** Stored with a new choice. */
  version: number;
  /** Stored versions this notice honors. */
  accepts: readonly number[];
}

/**
 * While no optional tool is configured. It also honors a choice made under ANALYTICS_NOTICE:
 * nothing optional runs here, and a moment when the setting cannot be read (the page then renders
 * as if Google Analytics were not configured) must not ask everyone again.
 */
export const BASE_NOTICE: ConsentNotice = {
  version: CONSENT_VERSION,
  accepts: [CONSENT_VERSION, CONSENT_VERSION + ANALYTICS_NOTICE_OFFSET],
};

/** While Google Analytics is configured: only a choice made under this notice counts. */
export const ANALYTICS_NOTICE: ConsentNotice = {
  version: CONSENT_VERSION + ANALYTICS_NOTICE_OFFSET,
  accepts: [CONSENT_VERSION + ANALYTICS_NOTICE_OFFSET],
};

/** The notice for a page: ANALYTICS_NOTICE while Google Analytics is configured. */
export function consentNotice(analyticsInUse: boolean): ConsentNotice {
  return analyticsInUse ? ANALYTICS_NOTICE : BASE_NOTICE;
}

/** A choice is kept this long, then the visitor is asked again (12 months). */
export const CONSENT_MAX_AGE_DAYS = 365;

const DAY_MS = 86_400_000;
/** A choice dated a little in the future is a clock difference, not a forged cookie. */
const CLOCK_SKEW_MS = DAY_MS;

/** Categories that need the visitor's consent. "necessary" is always on. */
export const OPTIONAL_CATEGORIES = ["analytics", "marketing"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];
export type ConsentCategory = "necessary" | OptionalCategory;

/** What the cookie holds. */
export interface ConsentState {
  /** CONSENT_VERSION when the choice was made. */
  v: number;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  /** When the choice was made, ms since the epoch. */
  ts: number;
}

/** The part of a choice the visitor makes: one switch per optional category. */
export type ConsentChoice = Record<OptionalCategory, boolean>;

export const NECESSARY_ONLY: ConsentChoice = { analytics: false, marketing: false };
export const ACCEPT_ALL: ConsentChoice = { analytics: true, marketing: true };

/** The stored fields of a cookie value that has the right shape; null otherwise. */
function readStored(
  json: unknown,
): Pick<ConsentState, "v" | "analytics" | "marketing" | "ts"> | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const { v, necessary, analytics, marketing, ts } = json as Record<string, unknown>;
  if (typeof v !== "number" || typeof ts !== "number") return null;
  if (necessary !== true || typeof analytics !== "boolean" || typeof marketing !== "boolean") {
    return null;
  }
  return { v, analytics, marketing, ts };
}

/**
 * The stored choice from the cookie's value, or null when there is none to honor: missing,
 * malformed, a policy version the notice does not honor (`version`: a notice, or the one version
 * to accept), dated in the future or older than CONSENT_MAX_AGE_DAYS. Null means "ask". Extra
 * keys are dropped.
 */
export function parseConsent(
  value: string | null | undefined,
  now: number = Date.now(),
  version: number | ConsentNotice = BASE_NOTICE,
): ConsentState | null {
  const accepted = typeof version === "number" ? [version] : version.accepts;
  if (!value) return null;
  let json: unknown;
  try {
    json = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  const parsed = readStored(json);
  if (!parsed) return null;
  const { v, analytics, marketing, ts } = parsed;
  if (!accepted.includes(v) || !Number.isFinite(ts)) return null;
  if (ts > now + CLOCK_SKEW_MS || now - ts > CONSENT_MAX_AGE_DAYS * DAY_MS) return null;
  return { v, necessary: true, analytics, marketing, ts };
}

/** The value of cookie `name` in a `document.cookie` style string (the first one wins). */
export function readCookie(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The stored choice from a whole `document.cookie` string. */
export function consentFromCookies(
  cookies: string,
  now: number = Date.now(),
  notice: ConsentNotice = BASE_NOTICE,
): ConsentState | null {
  return parseConsent(readCookie(cookies, CONSENT_COOKIE), now, notice);
}

/** A new choice under the given policy version (the current notice's). */
export function makeConsent(
  choice: ConsentChoice,
  now: number = Date.now(),
  version: number = CONSENT_VERSION,
): ConsentState {
  return {
    v: version,
    necessary: true,
    analytics: choice.analytics === true,
    marketing: choice.marketing === true,
    ts: now,
  };
}

/**
 * The `document.cookie` assignment that stores a choice: 12 months, the whole site, SameSite=Lax,
 * Secure on https (production; plain http is local dev only). Host-only (no Domain).
 */
export function consentCookie(state: ConsentState, { secure }: { secure: boolean }): string {
  const value = encodeURIComponent(JSON.stringify(state));
  const maxAge = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
  return `${CONSENT_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * Whether a category may run. `consent` is undefined while unknown (the server render and
 * hydration, before the cookie is read) and null when the visitor has not chosen yet: an optional
 * category is off in both. "necessary" is always allowed.
 */
export function consentAllows(
  consent: ConsentState | null | undefined,
  category: ConsentCategory,
): boolean {
  if (category === "necessary") return true;
  return consent?.[category] === true;
}

/** Whether two states hold the same choice (the time aside). */
export function sameChoice(a: ConsentState, b: ConsentState): boolean {
  return a.v === b.v && a.analytics === b.analytics && a.marketing === b.marketing;
}
