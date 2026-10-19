// The agents' schedule (owner request 2026-10-19): Supabase's pg_cron posts here twice a day
// (supabase/migrations/20261019120000_agents.sql; Vercel Hobby's two cron jobs are the SEO
// refresh's) with `Authorization: Bearer CRON_SECRET`. Runs the product finder when the admin
// switched it on (lib/agents/server.ts); production only, since dev and preview share the database.
import { runFinderFor } from "@/lib/agents/server";
import { deployEnv } from "@/lib/env";
import { isCronAuthorized } from "@/lib/seo/cron-auth";

// Eight hot lists 1.1 s apart, a link call and one writer call (up to 45 s).
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (deployEnv() !== "production") {
    return Response.json({ ok: true, skipped: "not production" });
  }
  const result = await runFinderFor("cron");
  console.log(
    `[agents-cron] finder ${result.status} scanned=${result.scanned} added=${result.added} calls=${result.aliCalls} cost=${result.costUsd.toFixed(4)}${result.note ? ` note=${result.note}` : ""}`,
  );
  return Response.json({ ok: result.status !== "failed", finder: result });
}

export const POST = handle;
export const GET = handle;
