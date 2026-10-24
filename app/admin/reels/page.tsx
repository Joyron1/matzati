import type { Metadata } from "next";
import { Ban, CalendarClock, CheckCircle2, CircleAlert } from "lucide-react";
import { btnSecondary, btnSm, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { isQuietTime } from "@/lib/agents/schedule";
import { metaConfig } from "@/lib/meta/publish";
import type { Reel } from "@/lib/meta/reels-run";
import { listReels, signedReelUrl } from "@/lib/meta/reels-server";
import {
  fromIsraelLocal,
  REEL_MIN_LEAD_MS,
  reelTimeLabel,
  toIsraelLocal,
} from "@/lib/meta/reels-time";
import { firstParam } from "@/lib/search-url";
import { StatusMessage } from "../status-message";
import { cancelReelAction } from "./actions";
import { ReelForm } from "./reel-form";

export const metadata: Metadata = {
  title: "רילז", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  scheduled: "הרילז תוזמן. הוא יוכן אצל Meta עד שעה לפני הזמן ויעלה בזמן.",
  cancelled: "הרילז בוטל ולא יעלה.",
  invalid: "משהו בטופס לא תקין. נסו שוב.",
  "no-network": "בחרו לפחות רשת אחת: אינסטגרם או פייסבוק.",
  "too-soon": "הזמן קרוב מדי: לפחות 20 דקות מעכשיו.",
  "too-far": "אפשר לתזמן עד 60 יום קדימה.",
  quiet: "לא מפרסמים בשישי מ־17:00 עד שבת 19:30. בחרו זמן אחר.",
  failed: "לא הצלחנו לשמור. נסו שוב.",
};

const STATE: Record<Reel["status"], string> = {
  scheduled: "מתוזמן",
  cancelled: "בוטל",
  done: "עלה",
  partial: "עלה חלקית",
  failed: "נכשל",
};

/** The next 20:00 Israel time far enough ahead and not in the quiet hours: the form's suggestion. */
function suggestedTime(now: Date): Date {
  for (let d = 0; d < 14; d++) {
    const day = toIsraelLocal(new Date(now.getTime() + d * 24 * 60 * 60_000)).slice(0, 10);
    const at = fromIsraelLocal(`${day}T20:00`);
    if (at && at.getTime() > now.getTime() + REEL_MIN_LEAD_MS && !isQuietTime(at)) return at;
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
}

function Network({
  name,
  asked,
  postedAt,
  error,
}: {
  name: string;
  asked: boolean;
  postedAt: string | null;
  error: string | null;
}) {
  if (!asked) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {postedAt ? (
        <CheckCircle2 aria-hidden className="size-4 text-accent-ink" />
      ) : error ? (
        <CircleAlert aria-hidden className="size-4 text-ink" />
      ) : (
        <CalendarClock aria-hidden className="size-4 text-muted" />
      )}
      {name}
      {postedAt ? ": עלה" : error ? `: נכשל (${error})` : ""}
    </span>
  );
}

export default async function ReelsPage({ searchParams }: PageProps<"/admin/reels">) {
  await requireAdmin();
  const params = await searchParams;
  const status = STATUS[firstParam(params.status)] ?? null;
  let reels: Reel[] = [];
  let loadFailed = false;
  try {
    reels = await listReels();
  } catch (err) {
    console.error(`[admin-reels] ${String(err).slice(0, 200)}`);
    loadFailed = true;
  }
  const upcoming = reels
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const past = reels.filter((r) => r.status !== "scheduled");
  const previews = new Map(
    await Promise.all(
      upcoming.map(async (r) => [r.id, await signedReelUrl(r.video_path)] as const),
    ),
  );
  const now = new Date();
  const metaReady = metaConfig() !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">רילז לפייסבוק ואינסטגרם</h1>
        <p className="max-w-prose text-muted">
          מעלים סרטון, כותבים כיתוב, בוחרים רשתות וזמן. המערכת מכינה את הרילז אצל Meta עד שעה לפני
          ומפרסמת אותו בזמן. כל רילז אפשר לבטל עד שהוא עולה.
        </p>
        {!metaReady && (
          <p className="font-semibold text-ink">
            החיבור ל־Meta לא מוגדר (META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_USER_ID ב־Vercel):
            רילז שיתוזמנו לא יעלו עד שיוגדר.
          </p>
        )}
      </div>
      {status && <StatusMessage>{status}</StatusMessage>}

      <section aria-labelledby="new-reel" className={`${card} space-y-4 p-5 sm:p-6`}>
        <h2 id="new-reel" className="font-display text-2xl">
          רילז חדש
        </h2>
        <ReelForm
          defaultWhen={toIsraelLocal(suggestedTime(now))}
          minWhen={toIsraelLocal(new Date(now.getTime() + REEL_MIN_LEAD_MS))}
        />
      </section>

      <section aria-labelledby="upcoming" className="space-y-4">
        <h2 id="upcoming" className="font-display text-2xl">
          מתוזמנים <span className="text-muted">({upcoming.length})</span>
        </h2>
        {loadFailed ? (
          <p className="text-muted">לא הצלחנו לטעון. ודאו שהמיגרציה של הרילז הוחלה.</p>
        ) : !upcoming.length ? (
          <p className="text-muted">אין רילז מתוזמנים.</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((r) => (
              <li key={r.id} className={`${card} flex flex-wrap gap-4 p-4`}>
                {previews.get(r.id) && (
                  <video
                    src={previews.get(r.id) ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-44 rounded-xl border border-line bg-black"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-bold">{reelTimeLabel(new Date(r.scheduled_at))}</p>
                  <p className="line-clamp-4 text-sm whitespace-pre-line text-muted">{r.caption}</p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <Network
                      name="אינסטגרם"
                      asked={r.instagram}
                      postedAt={r.ig_posted_at}
                      error={r.ig_error}
                    />
                    <Network
                      name="פייסבוק"
                      asked={r.facebook}
                      postedAt={r.fb_posted_at}
                      error={r.fb_error}
                    />
                  </p>
                  {r.prepared_at && (
                    <p className="text-xs text-muted">הוכן אצל Meta, מחכה לזמן שלו.</p>
                  )}
                  <form action={cancelReelAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={`${btnSecondary} ${btnSm} gap-1.5`}>
                      <Ban aria-hidden className="size-4" />
                      ביטול
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past" className="space-y-4">
          <h2 id="past" className="font-display text-2xl">
            עלו ובוטלו
          </h2>
          <ul className={`${card} divide-y divide-line`}>
            {past.map((r) => (
              <li key={r.id} className="space-y-1 p-4">
                <p className="font-semibold">
                  {reelTimeLabel(new Date(r.scheduled_at))} · {STATE[r.status]}
                </p>
                <p className="line-clamp-2 text-sm text-muted">{r.caption}</p>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <Network
                    name="אינסטגרם"
                    asked={r.instagram}
                    postedAt={r.ig_posted_at}
                    error={r.ig_error}
                  />
                  <Network
                    name="פייסבוק"
                    asked={r.facebook}
                    postedAt={r.fb_posted_at}
                    error={r.fb_error}
                  />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
