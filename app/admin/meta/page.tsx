import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Download, Hand, Send } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { btnPrimary, btnSecondary, btnSm, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { isQuietTime } from "@/lib/agents/schedule";
import { META_DISCLOSURE, metaConfig } from "@/lib/meta/publish";
import type { MetaKind, MetaMedia, Reel } from "@/lib/meta/reels-run";
import { getReel, listReels, signedReelUrl } from "@/lib/meta/reels-server";
import { dayKeyOf, monthOf, parseDay, parseMonth } from "@/lib/meta/calendar";
import {
  fromIsraelLocal,
  REEL_MIN_LEAD_MS,
  reelTimeLabel,
  toIsraelLocal,
} from "@/lib/meta/reels-time";
import { firstParam } from "@/lib/search-url";
import { ownerTelegramState } from "@/lib/telegram/owner";
import { FormProgress, PendingButton } from "../progress";
import { StatusMessage } from "../status-message";
import { statusTone } from "../status-tone";
import {
  markPostedAction,
  telegramCodeAction,
  telegramConfirmAction,
  telegramUnlinkAction,
} from "./actions";
import {
  calendarHref,
  DayAgenda,
  itemsByDayKey,
  MetaCalendar,
  type CalendarLinks,
} from "./calendar";
import { MetaForm, type MetaFormInitial } from "./meta-form";
import {
  editable,
  filesOf,
  KIND_LABEL,
  KindBadge,
  KindFilter,
  kindOf,
  Networks,
  PastItem,
  Preview,
} from "./scheduled";

export const metadata: Metadata = {
  title: "Meta", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

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

/** How long a handed-off manual story stays in "לפרסום ידני". */
const MANUAL_SHOWN_MS = 7 * 24 * 60 * 60_000;

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
          <form action={telegramConfirmAction} className="space-y-3">
            <PendingButton className={`${btnPrimary} ${btnSm}`} busyLabel="בודקים…">
              שלחתי, בדיקת החיבור
            </PendingButton>
            <FormProgress
              ops={{ default: { label: "מחפשים את הקוד בהודעות לבוט", expectedMs: 3000 } }}
            />
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
  const statusKey = firstParam(params.status);
  const status = STATUS[statusKey] ?? null;
  const kindParam = firstParam(params.kind);
  const kindFilter: MetaKind | null =
    kindParam === "reel" || kindParam === "post" || kindParam === "story" ? kindParam : null;
  const editId = firstParam(params.edit);
  // The calendar's day (?day=) and month (?month=); a day sets its month.
  const selectedDay = parseDay(firstParam(params.day));
  const now = new Date();
  const today = dayKeyOf(now);
  const month =
    (selectedDay ? parseMonth(selectedDay.slice(0, 7)) : null) ??
    parseMonth(firstParam(params.month)) ??
    monthOf(now);
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
  const shown = kindFilter ? upcoming.filter((r) => kindOf(r) === kindFilter) : upcoming;
  const calendarItems = kindFilter ? items.filter((r) => kindOf(r) === kindFilter) : items;
  const links: CalendarLinks = { basePath: "/admin/meta", kind: kindFilter };
  const dayItems = selectedDay ? (itemsByDayKey(calendarItems).get(selectedDay) ?? []) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
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
      {status && <StatusMessage tone={statusTone(statusKey)}>{status}</StatusMessage>}

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
                        <PendingButton
                          className={`${btnPrimary} ${btnSm} gap-1.5`}
                          busyLabel="מסמנים…"
                        >
                          <CheckCircle2 aria-hidden className="size-4" />
                          פרסמתי
                        </PendingButton>
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

      <section id="calendar" aria-labelledby="upcoming" className="scroll-mt-20 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="upcoming" className="font-display text-2xl font-bold">
            מתוזמנים <span className="text-muted">({upcoming.length})</span>
          </h2>
          <KindFilter
            items={upcoming}
            current={kindFilter}
            href={(kind) => calendarHref({ ...links, kind }, { month, day: selectedDay })}
          />
        </div>
        {loadFailed ? (
          <p className="text-muted">לא הצלחנו לטעון. ודאו שהמיגרציות של Meta הוחלו.</p>
        ) : (
          <>
            <MetaCalendar
              items={calendarItems}
              month={month}
              today={today}
              selected={selectedDay}
              links={links}
              previews={previews}
            />
            <DayAgenda
              day={selectedDay}
              items={dayItems}
              shown={shown}
              kindFilter={kindFilter}
              allHref={calendarHref(links, { month }, "day")}
              previews={previews}
            />
          </>
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
              <PastItem key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
