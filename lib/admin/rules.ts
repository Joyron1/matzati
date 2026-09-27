// Pure admin sign-in rules (no server-only imports, so they are unit-tested directly):
// the ADMIN_EMAILS allow-list check, the origin for magic-link redirects, the fixed admin paths,
// the callback error codes, every Hebrew message the login page shows and the auth cookie options.
import { z } from "zod";

export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_LOGIN_PATH = "/admin/login";
export const AUTH_CALLBACK_PATH = "/admin/auth/callback";

/** Used when a request carries no usable host (local tooling). Matches `next dev -p 3100`. */
export const FALLBACK_ORIGIN = "http://localhost:3100";

// ---------------------------------------------------------------------------------------------
// Emails

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Trimmed, lowercased email from a form field, or null when it is not a valid address. */
export function normalizeEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** `allowed` comes from adminEmails() (already lowercased). Empty allows nobody. */
export function isAllowedAdmin(
  email: string | null | undefined,
  allowed: readonly string[],
): boolean {
  const e = email?.trim().toLowerCase();
  return !!e && allowed.includes(e);
}

export interface AuthUserLike {
  email?: string | null;
  email_confirmed_at?: string | null;
}

/**
 * The admin for a Supabase Auth user (from getUser(), never from the session cookie alone), or
 * null. The email must be confirmed: if email confirmation were ever switched off, anyone could
 * sign up with an admin's address and get a session without owning the inbox.
 */
export function adminFromUser(
  user: AuthUserLike | null | undefined,
  allowed: readonly string[],
): { email: string } | null {
  if (!user?.email || !user.email_confirmed_at) return null;
  const email = user.email.trim().toLowerCase();
  return isAllowedAdmin(email, allowed) ? { email } : null;
}

// ---------------------------------------------------------------------------------------------
// Origin for the magic link's emailRedirectTo

const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/;

const firstValue = (value: string | null) => value?.split(",")[0]?.trim().toLowerCase() || null;

function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name.endsWith(".localhost");
}

/**
 * Site origin from x-forwarded-host / host (Vercel sets both) and x-forwarded-proto. Only a bare
 * hostname with an optional port is accepted, so a crafted header cannot add a path, credentials or
 * another scheme. Public hosts always get https; plain http is kept for localhost only. Supabase
 * still refuses any redirect URL that is not on the project's allow-list.
 */
export function requestOrigin(headers: Pick<Headers, "get">): string {
  const host = firstValue(headers.get("x-forwarded-host")) ?? firstValue(headers.get("host"));
  if (!host || !HOST.test(host) || host.includes("..")) return FALLBACK_ORIGIN;
  if (!isLocalHost(host)) return `https://${host}`;
  const proto = firstValue(headers.get("x-forwarded-proto"));
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

export const authCallbackUrl = (origin: string) => `${origin}${AUTH_CALLBACK_PATH}`;

// ---------------------------------------------------------------------------------------------
// Callback errors (shown on /admin/login?error=<code>)

export const LOGIN_ERRORS = [
  "link_expired",
  "link_invalid",
  "other_browser",
  "not_allowed",
  "unavailable",
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

export const LOGIN_ERROR_MESSAGES: Record<LoginError, string> = {
  link_expired: "הקישור פג תוקף או שכבר השתמשו בו. בקשו קישור חדש.",
  link_invalid: "הקישור לא תקין. בקשו קישור חדש.",
  other_browser:
    "הקישור לא מתאים לדפדפן הזה. פתחו את הקישור האחרון שקיבלתם, באותו דפדפן שבו ביקשתם אותו, או בקשו קישור חדש.",
  not_allowed: "לחשבון הזה אין הרשאת ניהול.",
  unavailable: "הכניסה לא זמינה כרגע. נסו שוב בעוד כמה דקות.",
};

/** Fixed paths only, so a redirect built from these can never leave the site. */
export const loginErrorPath = (error: LoginError) => `${ADMIN_LOGIN_PATH}?error=${error}`;

/** The error code from the login page's search params. Unknown values are ignored, never shown. */
export function loginErrorFromParam(value: string | string[] | undefined): LoginError | null {
  const v = Array.isArray(value) ? value[0] : value;
  return (LOGIN_ERRORS as readonly string[]).includes(v ?? "") ? (v as LoginError) : null;
}

/** Supabase redirects to the callback with ?error=…&error_code=… when the link itself failed. */
export function linkErrorFromQuery(params: URLSearchParams): LoginError | null {
  const code = params.get("error_code");
  if (!code && !params.get("error")) return null;
  return code === "otp_expired" || code === "flow_state_expired" ? "link_expired" : "link_invalid";
}

export interface AuthErrorLike {
  name?: string;
  code?: string;
  status?: number;
}

/** Maps an exchangeCodeForSession error to what the login page tells the admin. */
export function exchangeErrorFor(error: AuthErrorLike | null | undefined): LoginError {
  const code = error?.code;
  if (
    code === "pkce_code_verifier_not_found" ||
    code === "bad_code_verifier" ||
    error?.name === "AuthPKCECodeVerifierMissingError"
  ) {
    // The PKCE verifier cookie lives in the browser that asked for the link, and only the most
    // recent request's verifier is used (no sb_flow_id: that needs wildcard redirect URLs).
    return "other_browser";
  }
  if (code === "flow_state_expired" || code === "flow_state_not_found" || code === "otp_expired") {
    return "link_expired";
  }
  if (!error?.status || error.status >= 500 || error.name === "AuthRetryableFetchError") {
    return "unavailable";
  }
  return "link_invalid";
}

// ---------------------------------------------------------------------------------------------
// Login form results

export type LoginStatus = "idle" | "sent" | "invalid_email" | "rate_limited" | "unavailable";

export interface LoginState {
  status: LoginStatus;
  message: string;
}

/**
 * "sent" is the answer for every valid address, admin or not (and even when the send itself
 * failed), so the form never tells anyone which addresses are admins.
 */
export const LOGIN_MESSAGES: Record<Exclude<LoginStatus, "idle">, string> = {
  sent: "אם הכתובת מורשית, שלחנו אליה קישור כניסה.",
  invalid_email: "כתבו כתובת אימייל תקינה.",
  rate_limited: "היו יותר מדי בקשות כניסה מהרשת הזו. נסו שוב מאוחר יותר.",
  unavailable: LOGIN_ERROR_MESSAGES.unavailable,
};

export const loginState = (status: Exclude<LoginStatus, "idle">): LoginState => ({
  status,
  message: LOGIN_MESSAGES[status],
});

/**
 * Every valid request takes at least this long, whether or not a link was sent, so response time
 * does not reveal which addresses are admins (sending takes a Supabase round trip).
 */
export const LOGIN_MIN_RESPONSE_MS = 1500;

export const paddingMs = (startedMs: number, nowMs: number, minMs = LOGIN_MIN_RESPONSE_MS) =>
  Math.max(0, minMs - (nowMs - startedMs));

/**
 * Stand-in for Supabase Auth on the login form's non-admin path. signInWithOtp writes its PKCE
 * verifier cookies before it calls the network, so running the same call against this (an empty
 * 200 for every request, nothing leaves the server, no email) gives a non-admin address the same
 * Set-Cookie headers as an admin one. Without it, those cookies alone would reveal admin addresses.
 */
export const decoyAuthFetch: typeof fetch = async () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------------------------------------
// Cookies

/** Supabase Auth cookies (`sb-<ref>-auth-token`, its chunks and PKCE verifiers). */
export const isSupabaseAuthCookie = (name: string) =>
  name.startsWith("sb-") && name.includes("-auth-token");

/**
 * Options for every Supabase Auth cookie we write (proxy.ts and lib/supabase/ssr.ts must agree).
 * There is no browser Supabase client, so no page script ever needs the session: httpOnly keeps an
 * injected script from reading the admin's refresh token. Secure outside local dev. SameSite stays
 * at the library's "lax": the magic link is a cross-site navigation that must carry the PKCE
 * verifier cookie to /admin/auth/callback.
 */
export const authCookieOptions = (nodeEnv: string | undefined = process.env.NODE_ENV) => ({
  httpOnly: true,
  secure: nodeEnv === "production",
});
