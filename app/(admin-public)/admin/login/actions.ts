"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { allowAdminLogin } from "@/lib/admin/login-rate";
import {
  ADMIN_HOME_PATH,
  adminFromUser,
  authCallbackUrl,
  decoyAuthFetch,
  isAllowedAdmin,
  loginState,
  normalizeEmail,
  paddingMs,
  PASSWORD_MAX_BYTES,
  passwordLoginState,
  requestOrigin,
  type LoginState,
  type PasswordLoginState,
} from "@/lib/admin/rules";
import { allowedAdminEmails } from "@/lib/admin/allowlist";
import { clientIp, hashIp } from "@/lib/guard/rate-limit";
import { serviceClient } from "@/lib/supabase/server";
import { authClient, deferredAuthClient } from "@/lib/supabase/ssr";

function logError(err: unknown) {
  // Never the email, the password or the IP: name, code and status only.
  const e = err as { name?: string; code?: string; status?: number } | null;
  const text =
    e && typeof e === "object"
      ? `${e.name ?? "Error"} code=${e.code ?? "-"} status=${e.status ?? "-"}`
      : String(err);
  console.error(`[admin-login] ${text.slice(0, 200)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Counts one sign-in attempt for the request's IP (lib/admin/login-rate.ts). "ok", or why the
 * attempt is refused: over the limit, or the counter could not be reached (fail closed, like the
 * search guard).
 */
async function countAttempt(): Promise<"ok" | "rate_limited" | "unavailable"> {
  const salt = process.env.IP_HASH_SALT?.trim() ?? "";
  if (!salt) {
    console.error("[admin-login] IP_HASH_SALT is not set");
    return "unavailable";
  }
  try {
    const ipHash = hashIp(clientIp(await headers()), salt);
    return (await allowAdminLogin(serviceClient(), ipHash, new Date())) ? "ok" : "rate_limited";
  } catch (err) {
    logError(err);
    return "unavailable";
  }
}

/** A Supabase Auth failure that is ours or theirs, not a wrong password: say "try again later". */
function isOutage(error: { status?: number; name?: string } | null | undefined): boolean {
  return !error?.status || error.status >= 500 || error.name === "AuthRetryableFetchError";
}

/**
 * Email and password sign-in. Only ADMIN_EMAILS reach Supabase Auth; any other address gets the
 * answer a wrong password gets, with no cookies and after the same minimum time, so the form never
 * reveals who is an admin. The session cookies are written only after a successful sign-in of a
 * confirmed admin (deferredAuthClient). 10 attempts per hour per IP, shared with the link form.
 */
export async function signInWithPassword(
  _prev: PasswordLoginState,
  formData: FormData,
): Promise<PasswordLoginState> {
  const started = Date.now();
  const email = normalizeEmail(formData.get("email"));
  const password = formData.get("password");
  if (
    !email ||
    typeof password !== "string" ||
    !password ||
    new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES
  ) {
    return passwordLoginState("invalid_input");
  }

  const counted = await countAttempt();
  if (counted !== "ok") return passwordLoginState(counted);

  const allowed = await allowedAdminEmails();
  let outcome: "signed_in" | "wrong_credentials" | "unavailable" = "wrong_credentials";
  if (isAllowedAdmin(email, allowed)) {
    try {
      const { client, commit } = await deferredAuthClient();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        logError(error);
        if (isOutage(error)) outcome = "unavailable";
      } else if (adminFromUser(data.user, allowed)) {
        commit();
        outcome = "signed_in";
      }
      // A user whose address is not confirmed gets no session cookies (never committed).
    } catch (err) {
      logError(err);
      outcome = "unavailable";
    }
  }

  await sleep(paddingMs(started, Date.now()));
  if (outcome === "signed_in") redirect(ADMIN_HOME_PATH);
  return passwordLoginState(outcome);
}

/**
 * Sends a magic link, but only to ADMIN_EMAILS: the fallback for a forgotten or not yet set
 * password. Every valid address gets the same answer, the same cookies and the same minimum time,
 * so the form never reveals who is an admin. Counted with the password attempts.
 */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const started = Date.now();
  const email = normalizeEmail(formData.get("email"));
  if (!email) return loginState("invalid_email");

  const counted = await countAttempt();
  if (counted !== "ok") return loginState(counted);

  const requestHeaders = await headers();
  const admin = isAllowedAdmin(email, await allowedAdminEmails());
  try {
    // Only an admin address reaches Supabase. Any other address runs the same call against a
    // stand-in that sends nothing (no request, no email), so the response sets the same PKCE
    // verifier cookies either way; cookie writes after the request (the library's cleanup when a
    // send fails) are dropped for the same reason. Otherwise the cookies would reveal admins.
    const supabase = await authClient({
      fetch: admin ? undefined : decoyAuthFetch,
      freezeCookiesOnFetch: true,
    });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authCallbackUrl(requestOrigin(requestHeaders)),
        shouldCreateUser: true,
      },
    });
    // Reported only in the server log: a different answer here would reveal an admin address.
    if (error) logError(error);
  } catch (err) {
    logError(err);
  }

  await sleep(paddingMs(started, Date.now()));
  return loginState("sent");
}
