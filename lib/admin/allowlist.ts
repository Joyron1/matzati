// Who may sign in to /admin: ADMIN_EMAILS (Vercel) and the rows of `admin_emails` (added in the
// Supabase dashboard, owner request 2026-10-04; 20261004120000_admin_emails.sql). Read with the
// service role, kept a minute per server instance; on a database failure the env list alone
// applies (fail closed for anyone else).
import "server-only";
import { adminEmails } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";

const TTL_MS = 60_000;
let cached: { at: number; emails: string[] } | null = null;

async function tableEmails(): Promise<string[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.emails;
  try {
    const { data, error } = await serviceClient().from("admin_emails").select("email").limit(200);
    if (error) throw new Error(error.message);
    const emails = (data ?? [])
      .map((r: { email: unknown }) =>
        typeof r.email === "string" ? r.email.trim().toLowerCase() : "",
      )
      .filter((e) => e.includes("@"));
    cached = { at: Date.now(), emails };
    return emails;
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-allowlist] ${text.slice(0, 200)}`);
    return cached?.emails ?? [];
  }
}

/** Lowercased admin addresses: ADMIN_EMAILS and the admin_emails table. */
export async function allowedAdminEmails(): Promise<string[]> {
  return [...new Set([...adminEmails(), ...(await tableEmails())])];
}
