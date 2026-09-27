"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_LOGIN_PATH, isSupabaseAuthCookie } from "@/lib/admin/rules";
import { authClient } from "@/lib/supabase/ssr";

/** "יציאה": ends this browser's session (revoked at Supabase) and returns to the sign-in page. */
export async function signOutAdmin(): Promise<void> {
  let signedOut = false;
  try {
    const supabase = await authClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    signedOut = !error;
    if (error) console.error(`[admin-logout] ${error.name}: ${error.message}`.slice(0, 300));
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-logout] ${text.slice(0, 300)}`);
  }
  if (!signedOut) {
    // Supabase could not be reached: still drop the session cookies in this browser.
    const store = await cookies();
    for (const { name } of store.getAll()) {
      if (isSupabaseAuthCookie(name)) store.delete(name);
    }
  }
  redirect(ADMIN_LOGIN_PATH);
}
