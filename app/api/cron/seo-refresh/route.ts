// Vercel Cron (vercel.json: daily at 01:00 and 03:00 UTC, CRON_RUNS_PER_NIGHT, Hobby's limit of 2):
// continues the SEO landing pages whose lines are still being written, then refreshes those that
// are due, stalest first, about one page per run (lib/seo/refresh.ts refreshStale), so every
// published page is refreshed about once a week with up to 20 pages. Only Vercel Cron may call it
// (Authorization: Bearer CRON_SECRET). Safe to call again: a page tried in the last 20 hours is
// skipped (a continuation after 30 minutes), and a refresh only replaces a snapshot with a run at
// least as good.
import { revalidatePath } from "next/cache";
import { isCronAuthorized } from "@/lib/seo/cron-auth";
import { seoRefresher, snapshotWritesAllowed } from "@/lib/seo/refresh-server";
import { seoPath } from "@/lib/seo/slug";

// Vercel Hobby's limit; refreshStale stops starting pages well before it (CRON_LIMITS).
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Dev and preview deployments share production's database: they never write its snapshots.
  if (!snapshotWritesAllowed()) {
    return Response.json({ ok: true, skipped: "not production" });
  }
  try {
    const summary = await seoRefresher.refreshStale();
    // The pages whose stored results changed render again on their next visit.
    for (const slug of summary.stored) revalidatePath(seoPath(slug));
    const counts = {
      due: summary.due,
      stored: summary.stored.length,
      preparing: summary.preparing,
      kept: summary.kept,
      failed: summary.failed,
      busy: summary.busy,
      not_reached: summary.notReached,
    };
    console.log(
      `[seo-cron] ${Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`,
    );
    return Response.json({ ok: true, ...counts });
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[seo-cron] ${text.slice(0, 300)}`);
    return Response.json({ ok: false }, { status: 500 });
  }
}
