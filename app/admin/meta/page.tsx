import type { Metadata } from "next";
import Link from "next/link";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Download,
  Hand,
  Pencil,
  Send,
} from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { btnPrimary, btnSecondary, btnSm, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { isQuietTime } from "@/lib/agents/schedule";
import { META_DISCLOSURE, metaConfig } from "@/lib/meta/publish";
import type { MetaKind, MetaMedia, Reel } from "@/lib/meta/reels-run";
import { getReel, listReels, signedReelUrl } from "@/lib/meta/reels-server";
import {
  fromIsraelLocal,
  REEL_MIN_LEAD_MS,
  reelTimeLabel,
  toIsraelLocal,
} from "@/lib/meta/reels-time";
import { firstParam } from "@/lib/search-url";
import { ownerTelegramState } from "@/lib/telegram/owner";
import { StatusMessage } from "../status-message";
import {
  cancelMetaAction,
  markPostedAction,
  telegramCodeAction,
  telegramConfirmAction,
  telegramUnlinkAction,
} from "./actions";
import { MetaForm, type MetaFormInitial } from "./meta-form";

export const metadata: Metadata = {
  title: "Meta", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const KIND_LABEL: Record<MetaKind, string> = { post: "פוסט", story: "סטורי", reel: "רילז" };

const STATUS: Record<string, string> = {
  "scheduled-post": "הפוסט תוזמן ויעלה בזמן.",
  "scheduled-story": "הסטורי תוזמן ויעלה בזמן.",
  "scheduled-reel": "הרילז תוזמן. הוא יוכן אצל Meta עד שעה לפני הזמן ויעלה בזמן.",
  "scheduled-manual": "הסטורי תוזמן לפרסום ידני: בזמן שלו הוא יישלח אליכם בטלגרם עם הקישור.",
  updated: "השינויים נשמרו.",
  "not-editable": "אי אפשר לערוך: הפריט כבר עלה, בוטל או נשלח אליכם.",
  posted: "סומן כפורסם.",
  cancelled: "בוטל ולא יעלה.",
  invalid: "משהו בטופס לא תקין. נסו שוב.",
  "no-media": "העלו קודם את התמונות או הסרטון.",
  "no-caption": "כתבו כיתוב.",
  "no-link": "בסטורי ידני הדביקו את הקישור למוצר.",
  "bad-link": "לא הצלחנו להבין את הקישור. הדביקו קישור למוצר באלי אקספרס או מספר מוצר.",
  "no-network": "בחרו לפחות רשת אחת: אינסטגרם או פייסבוק.",
  "too-soon": "הזמן קרוב מדי: לפחות 20 דקות מעכשיו.",
  "too-far": "אפשר לתזמן עד 60 יום קדימה.",
  quiet: "לא מפרסמים בשישי מ־17:00 עד שבת 19:30. בחרו זמן אחר.",
  failed: "לא הצלחנו לשמור. נסו שוב.",
  "tg-code": "נוצר קוד חיבור. שלחו אותו לבוט ולחצו ״בדיקת החיבור״.",
  "tg-linked": "הטלגרם שלכם מחובר.",
  "tg-not-found": "לא מצאנו את הקוד בהודעות לבוט. ודאו ששלחתם אותו בצ׳אט פרטי עם הבוט, ונסו שוב.",
  "tg-expired": "הקוד פג. צרו קוד חדש.",
  "tg-not-configured": "הבוט של טלגרם לא מוגדר (TELEGRAM_BOT_TOKEN ב־Vercel).",
  "tg-failed": "טלגרם לא ענה. נסו שוב בעוד דקה.",
  "tg-unlinked": "החיבור לטלגרם שלכם נותק.",
};

const STATE: Record<Reel["status"], string> = {
  scheduled: "מתוזמן",
  cancelled: "בוטל",
  done: "עלה",
  partial: "עלה חלקית",
  failed: "נכשל",
};

/** How long a handed-off manual story stays in "לפרסום ידני". */
const MANUAL_SHOWN_MS = 7 * 24 * 60 * 60_000;

const kindOf = (r: Reel): MetaKind => r.kind ?? "reel";
const filesOf = (r: Reel): MetaMedia[] =>
  kindOf(r) === "reel"
    ? r.video_path
      ? [{ path: r.video_path, type: "video" }]
      : []
    : (r.media ?? []);
const editable = (r: Reel) =>
  r.status === "scheduled" && !r.ig_posted_at && !r.fb_posted_at && !r.notified_at;

/** The next 20:00 Israel time far enough ahead and not in the quiet hours: the form's suggestion. */
function suggestedTime(now: Date): Date {
  for (let d = 0; d < 14; d++) {
    const day = toIsraelLocal(new Date(now.getTime() + d * 24 * 60 * 60_000)).slice(0, 10);
    const at = fromIsraelLocal(`${day}T20:00`);
    if (at && at.getTime() > now.getTime() + REEL_MIN_LEAD_MS && !isQuietTime(at)) return at;
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
}

async function editInitial(r: Reel): Promise<MetaFormInitial> {
  const files = await Promise.all(
    filesOf(r).map(async (f) => ({ ...f, preview: (await signedReelUrl(f.path)) ?? "" })),
  );
  const suffix = `\n\n${META_DISCLOSURE}`;
  const disclosure = r.caption.endsWith(suffix);
  return {
    id: r.id,
    kind: kindOf(r),
    files,
    caption: disclosure ? r.caption.slice(0, -suffix.length) : r.caption,
    disclosure,
    when: toIsraelLocal(new Date(r.scheduled_at)),
    facebook: r.facebook,
    instagram: r.instagram,
    manual: !!r.manual,
    link: r.link_url ?? "",
    cover: r.cover_path
      ? { path: r.cover_path, preview: (await signedReelUrl(r.cover_path)) ?? "" }
      : null,
  };
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

function Networks({ r }: { r: Reel }) {
  if (r.manual) {
    const where = [r.instagram ? "אינסטגרם" : null, r.facebook ? "פייסבוק" : null]
      .filter(Boolean)
      .join(" + ");
    return (
      <p className="flex items-center gap-1 text-sm">
        <Hand aria-hidden className="size-4 text-muted" />
        פרסום ידני ב{where}
        {r.notified_at &&
          (r.notify_error ? " · לא נשלח בטלגרם, הקובץ כאן בפאנל" : " · נשלח אליכם בטלגרם")}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <Network name="אינסטגרם" asked={r.instagram} postedAt={r.ig_posted_at} error={r.ig_error} />
      <Network name="פייסבוק" asked={r.facebook} postedAt={r.fb_posted_at} error={r.fb_error} />
    </p>
  );
}

function KindBadge({ r }: { r: Reel }) {
  const kind = kindOf(r);
  const count = filesOf(r).length;
  return (
    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-ink">
      {KIND_LABEL[kind]}
      {kind === "post" && count > 1 ? ` · ${count} תמונות` : ""}
      {r.manual ? " · ידני עם קישור" : ""}
    </span>
  );
}

function Preview({ file, url }: { file: MetaMedia; url: string | null }) {
  if (!url) return null;
  return file.type === "video" ? (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className="h-44 rounded-lg border border-line bg-black"
    />
  ) : (
    // A signed storage URL: next/image's loader is for AliExpress photos.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-44 max-w-44 rounded-lg border border-line bg-surface-2 object-contain"
    />
  );
}

async function TelegramBox() {
  const tg = await ownerTelegramState();
  return (
    <section
      id="telegram"
      aria-labelledby="telegram-title"
      className={`${card} scroll-mt-20 space-y-3 p-5 sm:p-6`}
    >
      <h2 id="telegram-title" className="flex items-center gap-2 text-xl font-bold">
        <Send aria-hidden className="size-5 text-accent" />
        הטלגרם שלכם (לסטוריז ידניים)
      </h2>
      {!tg.configured ? (
        <p className="text-muted">הבוט של טלגרם לא מוגדר ב־Vercel (TELEGRAM_BOT_TOKEN).</p>
      ) : tg.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5">
            <CheckCircle2 aria-hidden className="size-5 text-trust" />
            מחובר. סטוריז ידניים יגיעו לצ׳אט הפרטי שלכם עם הבוט.
          </p>
          <form action={telegramUnlinkAction}>
            <button type="submit" className={`${btnSecondary} ${btnSm}`}>
              ניתוק
            </button>
          </form>
        </div>
      ) : tg.code ? (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 ps-5 text-sm">
            <li>פתחו בטלגרם צ׳אט פרטי עם הבוט של הערוץ (מהטלפון שלכם).</li>
            <li>שלחו לו את הקוד הזה בדיוק (תקף 30 דקות):</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <code
              dir="ltr"
              className="rounded-lg bg-surface-2 px-4 py-2 text-2xl font-bold tracking-widest"
            >
              {tg.code}
            </code>
            <CopyButton value={tg.code} />
          </div>
          <form action={telegramConfirmAction}>
            <button type="submit" className={`${btnPrimary} ${btnSm}`}>
              שלחתי, בדיקת החיבור
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            כדי שסטורי ידני יגיע אליכם בזמן שלו, חברו את הצ׳אט הפרטי שלכם עם הבוט. בלי חיבור הוא
            יחכה לכם כאן בפאנל, ב״לפרסום ידני״.
          </p>
          <form action={telegramCodeAction}>
            <button type="submit" className={`${btnSecondary} ${btnSm}`}>
              קבלת קוד חיבור
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

export default async function MetaPage({ searchParams }: PageProps<"/admin/meta">) {
  await requireAdmin();
  const params = await searchParams;
  const status = STATUS[firstParam(params.status)] ?? null;
  const editId = firstParam(params.edit);
  let items: Reel[] = [];
  let loadFailed = false;
  try {
    items = await listReels();
  } catch (err) {
    console.error(`[admin-meta] ${String(err).slice(0, 200)}`);
    loadFailed = true;
  }
  const now = new Date();
  const upcoming = items
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const manualDue = items.filter(
    (r) =>
      r.manual &&
      r.notified_at &&
      !r.manual_done_at &&
      now.getTime() - Date.parse(r.notified_at) < MANUAL_SHOWN_MS,
  );
  const past = items.filter((r) => r.status !== "scheduled" && !manualDue.includes(r));

  const editing = /^[0-9a-f-]{36}$/.test(editId)
    ? (items.find((r) => r.id === editId) ?? (await getReel(editId).catch(() => null)))
    : null;
  const initial = editing && editable(editing) ? await editInitial(editing) : null;

  // Previews of the upcoming items' files (signed for an hour; up to 4 per item).
  const previews = new Map(
    await Promise.all(
      upcoming.map(async (r) => {
        // A Reel's cover first, then its files.
        const files: MetaMedia[] = [
          ...(r.cover_path ? [{ path: r.cover_path, type: "image" as const }] : []),
          ...filesOf(r),
        ].slice(0, 4);
        const urls = await Promise.all(files.map((f) => signedReelUrl(f.path)));
        return [r.id, files.map((f, i) => ({ file: f, url: urls[i] }))] as const;
      }),
    ),
  );
  // A manual story's file: shown, and downloadable (signed for a day).
  const manualFiles = new Map(
    await Promise.all(
      manualDue.map(async (r) => {
        const f = filesOf(r)[0];
        if (!f) return [r.id, null] as const;
        const name = `story-${toIsraelLocal(new Date(r.scheduled_at)).slice(0, 10)}.${f.type === "video" ? "mp4" : "jpg"}`;
        const [view, download] = await Promise.all([
          signedReelUrl(f.path, 24 * 60 * 60),
          signedReelUrl(f.path, 24 * 60 * 60, name),
        ]);
        return [r.id, { file: f, view, download }] as const;
      }),
    ),
  );
  const metaReady = metaConfig() !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-bold">פרסום בפייסבוק ובאינסטגרם</h1>
        <p className="max-w-prose text-muted">
          מעלים באנר, תמונות או סרטון, כותבים כיתוב, בוחרים רשתות וזמן. המערכת מפרסמת בזמן: פוסט
          (תמונה או קרוסלה), סטורי או רילז. אפשר לערוך ולבטל עד שזה עולה.
        </p>
        {!metaReady && (
          <p className="font-semibold text-ink">
            החיבור ל־Meta לא מוגדר (META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_USER_ID ב־Vercel):
            מה שיתוזמן לא יעלה עד שיוגדר.
          </p>
        )}
      </div>
      {status && <StatusMessage>{status}</StatusMessage>}

      {manualDue.length > 0 && (
        <section aria-labelledby="manual" className="space-y-4">
          <h2 id="manual" className="flex items-center gap-2 font-display text-2xl font-bold">
            <Hand aria-hidden className="size-6 text-accent" />
            לפרסום ידני עכשיו <span className="text-muted">({manualDue.length})</span>
          </h2>
          <ul className="space-y-3">
            {manualDue.map((r) => {
              const m = manualFiles.get(r.id);
              return (
                <li key={r.id} className={`${card} flex flex-wrap gap-4 border-accent/40 p-4`}>
                  {m && <Preview file={m.file} url={m.view} />}
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      <KindBadge r={r} />
                      {reelTimeLabel(new Date(r.scheduled_at))}
                    </p>
                    {r.link_title && <p className="text-sm">{r.link_title}</p>}
                    {r.link_url && (
                      <div className="flex flex-wrap items-center gap-2">
                        <code
                          dir="ltr"
                          className="min-w-0 truncate rounded-lg bg-surface-2 px-3 py-2 text-sm"
                        >
                          {r.link_url}
                        </code>
                        <CopyButton value={r.link_url} />
                      </div>
                    )}
                    <Networks r={r} />
                    <div className="flex flex-wrap gap-2">
                      {m?.download && (
                        <a href={m.download} className={`${btnSecondary} ${btnSm} gap-1.5`}>
                          <Download aria-hidden className="size-4" />
                          הורדת הקובץ
                        </a>
                      )}
                      <form action={markPostedAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" className={`${btnPrimary} ${btnSm} gap-1.5`}>
                          <CheckCircle2 aria-hidden className="size-4" />
                          פרסמתי
                        </button>
                      </form>
                    </div>
                    <p className="text-xs text-muted">
                      העלו מהאפליקציה, הוסיפו מדבקת קישור עם הקישור, וכתבו על הסטורי ״קישור שותפים״.
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {initial ? (
        <section
          id="edit"
          aria-labelledby="edit-title"
          className={`${card} scroll-mt-20 space-y-4 border-accent/40 p-5 sm:p-6`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="edit-title" className="font-display text-2xl font-bold">
              עריכת ה{KIND_LABEL[initial.kind]}
            </h2>
            <Link href="/admin/meta" className={`${btnSecondary} ${btnSm}`}>
              ביטול העריכה
            </Link>
          </div>
          <MetaForm
            key={initial.id}
            initial={initial}
            defaultWhen={initial.when}
            minWhen={toIsraelLocal(new Date(now.getTime() + REEL_MIN_LEAD_MS))}
          />
        </section>
      ) : (
        <section aria-labelledby="new-meta" className={`${card} space-y-4 p-5 sm:p-6`}>
          {editId && (
            <p className="font-semibold">אי אפשר לערוך את הפריט הזה: הוא כבר עלה, בוטל או נשלח.</p>
          )}
          <h2 id="new-meta" className="font-display text-2xl font-bold">
            תזמון חדש
          </h2>
          <MetaForm
            defaultWhen={toIsraelLocal(suggestedTime(now))}
            minWhen={toIsraelLocal(new Date(now.getTime() + REEL_MIN_LEAD_MS))}
          />
        </section>
      )}

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
                  {(previews.get(r.id) ?? []).map(({ file, url }) => (
                    <Preview key={file.path} file={file} url={url} />
                  ))}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    <KindBadge r={r} />
                    {reelTimeLabel(new Date(r.scheduled_at))}
                  </p>
                  {r.caption && (
                    <p className="line-clamp-4 text-sm whitespace-pre-line text-muted">
                      {r.caption}
                    </p>
                  )}
                  {r.link_title && <p className="text-sm text-muted">🔗 {r.link_title}</p>}
                  <Networks r={r} />
                  {r.prepared_at && (
                    <p className="text-xs text-muted">הוכן אצל Meta, מחכה לזמן שלו.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {editable(r) && (
                      <Link
                        href={`/admin/meta?edit=${r.id}#edit`}
                        className={`${btnSecondary} ${btnSm} gap-1.5`}
                      >
                        <Pencil aria-hidden className="size-4" />
                        עריכה
                      </Link>
                    )}
                    <form action={cancelMetaAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className={`${btnSecondary} ${btnSm} gap-1.5`}>
                        <Ban aria-hidden className="size-4" />
                        ביטול
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TelegramBox />

      {past.length > 0 && (
        <section aria-labelledby="past" className="space-y-4">
          <h2 id="past" className="font-display text-2xl font-bold">
            עלו ובוטלו
          </h2>
          <ul className={`${card} divide-y divide-line`}>
            {past.map((r) => (
              <li key={r.id} className="space-y-1 p-4">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <KindBadge r={r} />
                  {reelTimeLabel(new Date(r.scheduled_at))} ·{" "}
                  {r.manual && r.status === "done"
                    ? r.manual_done_at
                      ? "פורסם ידנית"
                      : "נשלח לפרסום ידני"
                    : STATE[r.status]}
                </p>
                {r.caption && <p className="line-clamp-2 text-sm text-muted">{r.caption}</p>}
                <Networks r={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
