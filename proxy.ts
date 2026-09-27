// Refreshes the Supabase Auth session cookie before /admin pages render (the @supabase/ssr proxy
// pattern: Server Components cannot write cookies, so an expired access token is renewed here).
// It only keeps the session fresh; it is not the auth check. Every admin page, server action and
// route still calls requireAdmin() (lib/admin/auth.ts), which verifies the user with getUser().
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions } from "@/lib/admin/rules";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return response; // the page shows the sign-in error state

  const supabase = createServerClient(url, key, {
    cookieOptions: authCookieOptions(), // same as lib/supabase/ssr.ts
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // The page must see the refreshed tokens too, so update the request as well.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Cache-Control: private, no-store (never cache a response that sets session cookies).
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  // Nothing may run between creating the client and this call. Without auth cookies it returns
  // at once, with no network call.
  try {
    await supabase.auth.getClaims();
  } catch {
    // A failed refresh must not block the request; the page's getUser() decides access.
  }

  return response;
}

export const config = {
  // Only admin routes (`:path*` also matches /admin itself). Public pages never touch auth.
  matcher: ["/admin/:path*"],
};
