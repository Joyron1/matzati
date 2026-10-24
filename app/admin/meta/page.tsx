import type { Metadata } from "next";
import { Ban, CalendarClock, CheckCircle2, CircleAlert } from "lucide-react";
import { btnSecondary, btnSm, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { isQuietTime } from "@/lib/agents/schedule";
import { metaConfig } from "@/lib/meta/publish";
import type { MetaKind, MetaMedia, Reel } from "@/lib/meta/reels-run";
import { listReels, signedReelUrl } from "@/lib/meta/reels-server";
import {
  fromIsraelLocal,
  REEL_MIN_LEAD_MS,
  reelTimeLabel,
  toIsraelLocal,
} from "@/lib/meta/reels-time";
import { firstParam } from "@/lib/search-url";
import { StatusMessage } from "../status-message";
import { cancelMetaAction } from "./actions";
import { MetaForm } from "./meta-form";

export const metadata: Metadata = {
  title: "Meta", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const KIND_LABEL: Record<MetaKind, string> = { post: "פוסט", story: "סטורי", reel: "רילז" };

const STATUS: Record<string, string> = {
  "scheduled-post": "הפוסט תוזמן ויעלה בזמן.",
  "scheduled-story": "הסטורי תוזמן ויעלה בזמן.",
  "scheduled-reel": "הרילז תוזמן. הוא יוכן אצל Meta עד שעה לפני הזמן ויעלה בזמן.",
  cancelled: "בוטל ולא יעלה.",
  invalid: "משהו בטופס לא תקין. נסו שוב.",
  "no-media": "העלו קודם את התמונות או הסרטון.",
  "no-caption": "כתבו כיתוב.",
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

const kindOf = (r: Reel): MetaKind => r.kind ?? "reel";
const filesOf = (r: Reel): MetaMedia[] =>
  kindOf(r) === "reel"
    ? r.video_path
      ? [{ path: r.video_path, type: "video" }]
      : []
    : (r.media ?? []);

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
        <CheckCircle2 aria-hidden className="size-4 text-trust" />
      ) : error ? (
        <CircleAlert aria-hidden className="size-4 text-accent" />
      ) : (
        <CalendarClock aria-hidden className="size-4 text-muted" />
      )}
      {name}
      {postedAt ? ": עלה" : error ? `: נכשל (${error})` : ""}
    </span>
  );
}

function KindBadge({ kind, count }: { kind: MetaKind; count: number }) {
  return (
    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-ink">
      {KIND_LABEL[kind]}
      {kind === "post" && count > 1 ? ` · ${count} תמונות` : ""}
    </span>
  );
}

export default async function MetaPage({ searchParams }: PageProps<"/admin/meta">) {
  await requireAdmin();
  const params = await searchParams;
  const status = STATUS[firstParam(params.status)] ?? null;
  let items: Reel[] = [];
  let loadFailed = false;
  try {
    items = await listReels();
  } catch (err) {
    console.error(`[admin-meta] ${String(err).slice(0, 200)}`);
    loadFailed = true;
  }
  const upcoming = items
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const past = items.filter((r) => r.status !== "scheduled");
  // Previews of the upcoming items' files (signed for an hour; up to 4 per item).
  const previews = new Map(
    await Promise.all(
      upcoming.map(async (r) => {
        const files = filesOf(r).slice(0, 4);
        const urls = await Promise.all(files.map((f) => signedReelUrl(f.path)));
        return [r.id, files.map((f, i) => ({ ...f, url: urls[i] }))] as const;
      }),
    ),
  );
  const now = new Date();
  const metaReady = metaConfig() !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-bold">פרסום בפייסבוק ובאינסטגרם</h1>
        <p className="max-w-prose text-muted">
          מעלים באנר, תמונות או סרטון, כותבים כיתוב, בוחרים רשתות וזמן. המערכת מפרסמת בזמן: פוסט
          (תמונה או קרוסלה), סטורי או רילז. אפשר לבטל עד שזה עולה.
        </p>
        {!metaReady && (
          <p className="font-semibold text-ink">
            החיבור ל־Meta לא מוגדר (META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_USER_ID ב־Vercel):
            מה שיתוזמן לא יעלה עד שיוגדר.
          </p>
        )}
      </div>
      {status && <StatusMessage>{status}</StatusMessage>}

      <section aria-labelledby="new-meta" className={`${card} space-y-4 p-5 sm:p-6`}>
        <h2 id="new-meta" className="font-display text-2xl font-bold">
          תזמון חדש
        </h2>
        <MetaForm
          defaultWhen={toIsraelLocal(suggestedTime(now))}
          minWhen={toIsraelLocal(new Date(now.getTime() + REEL_MIN_LEAD_MS))}
        />
      </section>

      <section aria-labelledby="upcoming" className="space-y-4">
        <h2 id="upcoming" className="font-display text-2xl font-bold">
          מתוזמנים <span className="text-muted">({upcoming.length})</span>
        </h2>
        {loadFailed ? (
          <p className="text-muted">לא הצלחנו לטעון. ודאו שהמיגרציות של Meta הוחלו.</p>
        ) : !upcoming.length ? (
          <p className="text-muted">אין כרגע תוכן מתוזמן.</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((r) => (
              <li key={r.id} className={`${card} flex flex-wrap gap-4 p-4`}>
                <div className="flex flex-wrap gap-2">
                  {(previews.get(r.id) ?? []).map((f) =>
                    !f.url ? null : f.type === "video" ? (
                      <video
                        key={f.path}
                        src={f.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-44 rounded-lg border border-line bg-black"
                      />
                    ) : (
                      // A signed storage URL: next/image's loader is for AliExpress photos.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={f.path}
                        src={f.url}
                        alt=""
                        className="h-44 max-w-44 rounded-lg border border-line bg-surface-2 object-contain"
                      />
                    ),
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    <KindBadge kind={kindOf(r)} count={filesOf(r).length} />
                    {reelTimeLabel(new Date(r.scheduled_at))}
                  </p>
                  {r.caption && (
                    <p className="line-clamp-4 text-sm whitespace-pre-line text-muted">
                      {r.caption}
                    </p>
                  )}
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
                  <form action={cancelMetaAction}>
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
          <h2 id="past" className="font-display text-2xl font-bold">
            עלו ובוטלו
          </h2>
          <ul className={`${card} divide-y divide-line`}>
            {past.map((r) => (
              <li key={r.id} className="space-y-1 p-4">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <KindBadge kind={kindOf(r)} count={filesOf(r).length} />
                  {reelTimeLabel(new Date(r.scheduled_at))} · {STATE[r.status]}
                </p>
                {r.caption && <p className="line-clamp-2 text-sm text-muted">{r.caption}</p>}
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
