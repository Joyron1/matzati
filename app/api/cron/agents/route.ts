// The agents' schedule (owner requests 2026-10-19 and 10-23): Supabase's pg_cron posts here with
// `Authorization: Bearer CRON_SECRET` (Vercel Hobby's two cron jobs are the SEO refresh's):
// {"agent":"finder"} twice a day (the product finder, when the admin switched it on) and
// {"agent":"publish"} every 15 minutes (approved posts whose Telegram slot has come). Production
// only, since dev and preview share the database.
import { publishDue, runFinderFor } from "@/lib/agents/server";
import { deployEnv } from "@/lib/env";
import { isCronAuthorized } from "@/lib/seo/cron-auth";

// Eight hot lists 1.1 s apart, two AliExpress calls and one writer call (up to 45 s).
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (deployEnv() !== "production") {
    return Response.json({ ok: true, skipped: "not production" });
  }
  const body = (await request.json().catch(() => null)) as { agent?: unknown } | null;
  if (body?.agent === "publish") {
    const summary = await publishDue();
    if (summary.due) {
      console.log(
        `[agents-cron] publish due=${summary.due} posted=${summary.posted} failed=${summary.failed}`,
      );
    }
    return Response.json({ ok: true, publish: summary });
  }
  const result = await runFinderFor("cron");
  console.log(
    `[agents-cron] finder ${result.status} scanned=${result.scanned} added=${result.added} calls=${result.aliCalls} cost=${result.costUsd.toFixed(4)}${result.note ? ` note=${result.note}` : ""}`,
  );
  return Response.json({ ok: result.status !== "failed", finder: result });
}

export const POST = handle;
export const GET = handle;
