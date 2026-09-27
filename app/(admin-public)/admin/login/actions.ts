"use server";

import { headers } from "next/headers";
import { allowAdminLogin } from "@/lib/admin/login-rate";
import {
  authCallbackUrl,
  decoyAuthFetch,
  isAllowedAdmin,
  loginState,
  normalizeEmail,
  paddingMs,
  requestOrigin,
  type LoginState,
} from "@/lib/admin/rules";
import { adminEmails } from "@/lib/env";
import { clientIp, hashIp } from "@/lib/guard/rate-limit";
import { serviceClient } from "@/lib/supabase/server";
import { authClient } from "@/lib/supabase/ssr";

function logError(err: unknown) {
  // Never the email or the IP: name, code and status only.
  const e = err as { name?: string; code?: string; status?: number } | null;
  const text =
    e && typeof e === "object"
      ? `${e.name ?? "Error"} code=${e.code ?? "-"} status=${e.status ?? "-"}`
      : String(err);
  console.error(`[admin-login] ${text.slice(0, 200)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a magic link, but only to ADMIN_EMAILS. Every valid address gets the same answer, the same
 * cookies and the same minimum time, so the form never reveals who is an admin. 5 requests per
 * hour per IP.
 */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const started = Date.now();
  const email = normalizeEmail(formData.get("email"));
  if (!email) return loginState("invalid_email");

  const requestHeaders = await headers();
  const salt = process.env.IP_HASH_SALT?.trim() ?? "";
  if (!salt) {
    console.error("[admin-login] IP_HASH_SALT is not set");
    return loginState("unavailable");
  }
  try {
    const ipHash = hashIp(clientIp(requestHeaders), salt);
    if (!(await allowAdminLogin(serviceClient(), ipHash, new Date()))) {
      return loginState("rate_limited");
    }
  } catch (err) {
    logError(err);
    return loginState("unavailable"); // fail closed, like the search guard
  }

  const admin = isAllowedAdmin(email, adminEmails());
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
