// Per-request Supabase client that acts as the signed-in user: anon key + the Supabase Auth
// cookies, so RLS applies. Used for admin sign-in (lib/admin/auth.ts, /admin/login,
// /admin/auth/callback). Data writes still go through the service-role client in ./server.ts.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authCookieOptions } from "@/lib/admin/rules";

export interface AuthClientOptions {
  /** Replaces the network for this client (the login form's decoy for non-admin addresses). */
  fetch?: typeof fetch;
  /**
   * Ignore cookie writes once the client has made its first request. For the login form: a failed
   * send makes the library delete the PKCE verifier it has just written, and only admin addresses
   * reach Supabase, so that deletion alone would reveal an admin address.
   */
  freezeCookiesOnFetch?: boolean;
}

/**
 * An auth client whose cookie writes wait until `commit()`: the password sign-in writes them only
 * after a successful admin sign-in. A failed sign-in makes the library clear its session cookies,
 * and only admin addresses reach Supabase, so those writes alone would reveal an admin address.
 */
export async function deferredAuthClient(): Promise<{
  client: SupabaseClient;
  commit: () => void;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const cookieStore = await cookies();
  const pending = new Map<string, { value: string; options: object }>();
  const client = createServerClient(url, key, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) pending.set(name, { value, options });
      },
    },
  });
  return {
    client,
    commit() {
      for (const [name, { value, options }] of pending) cookieStore.set(name, value, options);
      pending.clear();
    },
  };
}

/** Create one per request; never share it (it carries that request's session). */
export async function authClient(options: AuthClientOptions = {}): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const cookieStore = await cookies();

  let fetched = false;
  const tracked: typeof fetch = (input, init) => {
    fetched = true;
    return (options.fetch ?? globalThis.fetch)(input, init);
  };
  const custom = options.fetch !== undefined || options.freezeCookiesOnFetch === true;

  return createServerClient(url, key, {
    cookieOptions: authCookieOptions(),
    ...(custom ? { global: { fetch: tracked } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        if (options.freezeCookiesOnFetch && fetched) return;
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine: proxy.ts refreshes the session
          // for every /admin request before the page renders, and server actions and route
          // handlers (sign-in, callback, logout) can set them.
        }
      },
    },
  });
}
