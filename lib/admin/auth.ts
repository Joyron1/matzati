// Admin session: Supabase Auth (magic link) from cookies, allowed only for ADMIN_EMAILS.
// The user is always verified with auth.getUser() (a round trip to Supabase Auth), never taken
// from the session cookie alone. Pure rules live in ./rules.ts.
import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { allowedAdminEmails } from "./allowlist";
import { authClient } from "@/lib/supabase/ssr";
import { ADMIN_LOGIN_PATH, adminFromUser } from "./rules";

export interface AdminUser {
  email: string;
}

// One getUser() per request, however many layouts, pages and components ask.
const currentAdmin = cache(async (): Promise<AdminUser | null> => {
  // Always decided at request time. Without this, a build with ADMIN_EMAILS unset would reach the
  // early return below without any request API and prerender admin pages as a static redirect.
  await connection();
  const allowed = await allowedAdminEmails();
  if (allowed.length === 0) return null; // nobody is admin: skip the network call
  try {
    const supabase = await authClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null; // signed out, expired or revoked
    return adminFromUser(data.user, allowed);
  } catch (err) {
    // Next's own control flow (e.g. the dynamic-rendering bailout from cookies()) is not a failure.
    unstable_rethrow(err);
    // Missing config or Supabase unreachable: fail closed. Name and message only, no values.
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-auth] ${text.slice(0, 300)}`);
    return null;
  }
});

/** The signed-in admin, or null when not signed in or the email is not in ADMIN_EMAILS. */
export async function getAdminUser(): Promise<AdminUser | null> {
  return currentAdmin();
}

/** For admin pages and server actions: returns the admin or redirects to /admin/login. */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await currentAdmin();
  if (!admin) redirect(ADMIN_LOGIN_PATH);
  return admin;
}
