// Magic-link landing: Supabase redirects here with ?code=… (PKCE). Exchanges the code for a
// session cookie, then lets only ADMIN_EMAILS in. Redirects go to fixed relative paths only.
import type { NextRequest } from "next/server";
import { adminEmails } from "@/lib/env";
import {
  ADMIN_HOME_PATH,
  adminFromUser,
  exchangeErrorFor,
  linkErrorFromQuery,
  loginErrorPath,
} from "@/lib/admin/rules";
import { authClient } from "@/lib/supabase/ssr";

// Cookies written through cookies() (the session, or its removal) are merged into this response.
function redirectTo(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "private, no-store" },
  });
}

function logError(err: unknown) {
  const text =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "object" && err && "code" in err
        ? `code ${String(err.code)}`
        : String(err);
  console.error(`[admin-callback] ${text.slice(0, 300)}`);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const linkError = linkErrorFromQuery(params);
  if (linkError) return redirectTo(loginErrorPath(linkError));

  const code = params.get("code");
  if (!code || code.length > 512) return redirectTo(loginErrorPath("link_invalid"));
  const flowId = params.get("sb_flow_id");

  try {
    const supabase = await authClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error || !data.user) {
      const reason = exchangeErrorFor(error);
      if (reason === "unavailable") logError(error);
      return redirectTo(loginErrorPath(reason));
    }
    if (!adminFromUser(data.user, adminEmails())) {
      // A valid link for an address that is not (or no longer) in ADMIN_EMAILS.
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) logError(signOutError);
      return redirectTo(loginErrorPath("not_allowed"));
    }
    return redirectTo(ADMIN_HOME_PATH);
  } catch (err) {
    logError(err);
    return redirectTo(loginErrorPath("unavailable"));
  }
}
