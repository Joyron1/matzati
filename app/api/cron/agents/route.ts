// The agents' schedule (owner requests 2026-10-19 and 10-23): Supabase's pg_cron posts here with
// `Authorization: Bearer CRON_SECRET` (Vercel Hobby's two cron jobs are the SEO refresh's):
// {"agent":"finder"} twice a day (the product finder, when the admin switched it on) and
// {"agent":"publish"} every 15 minutes (approved posts whose Telegram slot has come). Production
// only, since dev and preview share the database.
import { publishDue, runFinderFor } from "@/lib/agents/server";
import { deployEnv } from "@/lib/env";
import { publishDueReels } from "@/lib/meta/reels-server";
import { isCronAuthorized } from "@/lib/seo/cron-auth";
import { sendWeeklyPollIfDue } from "@/lib/telegram/group/server";

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
    // The scheduled Reels (owner request 2026-10-24): prepared an hour ahead, published on time.
    const reels = await publishDueReels().catch((err: unknown) => {
      console.error(`[agents-cron] reels: ${String(err).slice(0, 200)}`);
      return null;
    });
    if (reels && (reels.prepared || reels.published || reels.failed)) {
      console.log(
        `[agents-cron] reels prepared=${reels.prepared} published=${reels.published} failed=${reels.failed}`,
      );
    }
    // The weekly category poll in the channel (owner request 2026-10-25): Sunday 12:00, when on.
    const poll = await sendWeeklyPollIfDue().catch((err: unknown) => {
      console.error(`[agents-cron] poll: ${String(err).slice(0, 200)}`);
      return false;
    });
    if (poll) console.log("[agents-cron] weekly poll sent");
    return Response.json({ ok: true, publish: summary, reels, poll });
  }
  const result = await runFinderFor("cron");
  console.log(
    `[agents-cron] finder ${result.status} scanned=${result.scanned} added=${result.added} calls=${result.aliCalls} cost=${result.costUsd.toFixed(4)}${result.note ? ` note=${result.note}` : ""}`,
  );
  return Response.json({ ok: result.status !== "failed", finder: result });
}

export const POST = handle;
export const GET = handle;
