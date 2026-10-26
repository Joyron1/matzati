// The Telegram panel's "קבוצה וסקר" tab (owner requests 2026-10-25): the bot's webhook, the search
// group (picked from the chats the bot was added to), the members' daily limit, and the weekly
// category poll with the results of the last ones.
import { CheckCircle2, CircleDashed, Users, Vote } from "lucide-react";
import { btnPrimary, btnSecondary, btnSm, card } from "@/components/styles";
import { formatDateTime } from "@/lib/format";
import { listPolls, readGroupSettings, type StoredPoll } from "@/lib/telegram/group/store";
import { webhookStatus } from "@/lib/telegram/group/server";
import { readTgDiag } from "@/lib/telegram/diag";
import { FormProgress, PendingButton } from "../progress";
import { inputClass } from "../settings/form-parts";
import {
  chooseSearchGroupAction,
  connectWebhookAction,
  saveGroupSettingsAction,
  sendPollNowAction,
} from "./actions";

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  const Icon = done ? CheckCircle2 : CircleDashed;
  return (
    <li className="flex items-start gap-2">
      <Icon
        aria-hidden
        className={`mt-0.5 size-5 shrink-0 ${done ? "text-trust" : "text-muted"}`}
      />
      <span>{children}</span>
    </li>
  );
}

function PollResult({ poll }: { poll: StoredPoll }) {
  const max = Math.max(1, ...poll.options.map((o) => o.voters));
  const sorted = [...poll.options].sort((a, b) => b.voters - a.voters);
  return (
    <li className={`${card} space-y-3 p-4`}>
      <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-bold">{formatDateTime(poll.sent_at)}</span>
        <span className="text-muted">
          {poll.total_voters} הצביעו{poll.is_closed ? " · נסגר" : ""}
        </span>
      </p>
      <ul className="space-y-1.5">
        {sorted.map((o) => (
          <li key={o.text} className="space-y-1">
            <div className="flex justify-between gap-2 text-sm">
              <span>{o.text}</span>
              <bdi dir="ltr" className="font-semibold">
                {o.voters}
              </bdi>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-l from-cta-from to-cta-to"
                style={{ width: `${(o.voters / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

export async function GroupTab() {
  const [hook, settings, polls, diag] = await Promise.all([
    webhookStatus().catch(() => null),
    readGroupSettings().catch(() => null),
    listPolls(6).catch(() => null),
    readTgDiag().catch(() => []),
  ]);
  const groups = (settings?.seen ?? []).filter(
    (c) =>
      (c.type === "group" || c.type === "supergroup") &&
      c.status !== "left" &&
      c.status !== "kicked",
  );
  const chosen = settings?.searchChatId ?? null;
  const chosenAdmin = groups.find((g) => g.id === chosen)?.status === "administrator";

  return (
    <div className="space-y-8">
      <section aria-labelledby="group-title" className={`${card} space-y-4 p-5 sm:p-6`}>
        <h2 id="group-title" className="flex items-center gap-2 text-xl font-bold">
          <Users aria-hidden className="size-5 text-accent" />
          קבוצת החיפושים
        </h2>
        <p className="text-sm text-muted">
          חברי הקבוצה כותבים מה הם מחפשים, והבוט עונה עם 5 המוצרים המתאימים ביותר שעברו את הסינון
          (קולאז׳ ממוספר, הנתונים וקישור שותפים לכל מוצר), עם ״חיפוש רחב באתר״ ו״קופונים״. הודעה
          שאינה חיפוש נמחקת.
        </p>
        <ol className="space-y-2 text-sm">
          <Step done={!!hook?.connected}>
            חיבור הבוט לאתר (פעם אחת).{" "}
            {hook?.lastError && (
              <span className="text-accent-ink">שגיאה אחרונה: {hook.lastError}</span>
            )}
          </Step>
          <Step done={groups.length > 0}>
            בטלגרם: יוצרים קבוצה, מוסיפים את הבוט ומגדירים אותו <b>מנהל</b> עם ההרשאה ״מחיקת
            הודעות״. הקבוצה תופיע כאן.
          </Step>
          <Step done={!!chosen}>בוחרים כאן את הקבוצה כקבוצת החיפושים.</Step>
          <Step done={!!chosenAdmin}>הבוט מנהל בקבוצה (בלי זה הוא לא רואה הודעות ולא מוחק).</Step>
        </ol>
        {!hook?.connected && (
          <form action={connectWebhookAction} className="space-y-2">
            <PendingButton className={`${btnPrimary} ${btnSm}`} busyLabel="מחברים…">
              חיבור הבוט
            </PendingButton>
            <FormProgress ops={{ default: { label: "מחברים את הבוט לאתר", expectedMs: 2000 } }} />
          </form>
        )}
        {groups.length > 0 && (
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {groups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="font-semibold">{g.title || g.id}</span>{" "}
                  <span className="text-sm text-muted">
                    · {g.status === "administrator" ? "הבוט מנהל" : "הבוט עוד לא מנהל"}
                  </span>
                </span>
                {g.id === chosen ? (
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-trust">
                    <CheckCircle2 aria-hidden className="size-4" />
                    קבוצת החיפושים
                  </span>
                ) : (
                  <form action={chooseSearchGroupAction}>
                    <input type="hidden" name="chatId" value={g.id} />
                    <PendingButton className={`${btnSecondary} ${btnSm}`} busyLabel="שומרים…">
                      בחירה כקבוצת החיפושים
                    </PendingButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="tg-diag" className={`${card} space-y-3 p-5 sm:p-6`}>
        <h2 id="tg-diag" className="text-lg font-bold">
          מה הגיע לאחרונה מטלגרם
        </h2>
        {hook && (
          <p className="text-sm text-muted">
            ממתינים אצל טלגרם: {hook.pending}
            {hook.lastError ? ` · שגיאה אחרונה של טלגרם: ${hook.lastError}` : " · אין שגיאות"}
          </p>
        )}
        {!diag.length ? (
          <p className="text-sm">
            עוד לא הגיע שום עדכון מטלגרם מאז שהבדיקה הותקנה. כתבו הודעה בקבוצה ורעננו את העמוד.
          </p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {diag.map((e, i) => (
              <li key={i} className="py-2">
                <span className="font-semibold">{formatDateTime(e.at)}</span> · {e.kind}
                {e.chatType ? ` · ${e.chatType}` : ""}
                {e.chatTitle ? ` · ״${e.chatTitle}״` : ""}
                {e.chatId ? (
                  <>
                    {" "}
                    ·{" "}
                    <bdi dir="ltr" className="font-mono">
                      {e.chatId}
                    </bdi>
                  </>
                ) : null}
                {e.error && <span className="block text-accent-ink">{e.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="group-settings" className={`${card} space-y-4 p-5 sm:p-6`}>
        <h2 id="group-settings" className="text-xl font-bold">
          הגדרות
        </h2>
        <form action={saveGroupSettingsAction} className="space-y-4">
          <label className="block max-w-xs space-y-1.5">
            <span className="font-semibold">חיפושים ביום לכל חבר בקבוצה</span>
            <input
              type="number"
              name="dailyLimit"
              min={1}
              max={100}
              defaultValue={settings?.dailyLimit ?? 10}
              className={inputClass}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              name="pollEnabled"
              defaultChecked={settings?.pollEnabled ?? false}
              className="size-5 accent-[var(--accent)]"
            />
            <span>
              <span className="font-semibold">סקר שבועי בערוץ</span>{" "}
              <span className="text-sm text-muted">
                · כל ראשון ב־12:00: ״מאיזו קטגוריה הייתם רוצים לראות מוצרים השבוע?״
              </span>
            </span>
          </label>
          <PendingButton className={`${btnPrimary} ${btnSm}`} busyLabel="שומרים…">
            שמירה
          </PendingButton>
        </form>
      </section>

      <section aria-labelledby="polls" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="polls" className="flex items-center gap-2 text-xl font-bold">
            <Vote aria-hidden className="size-5 text-accent" />
            תוצאות הסקרים
          </h2>
          <form action={sendPollNowAction} className="space-y-2">
            <PendingButton className={`${btnSecondary} ${btnSm}`} busyLabel="שולחים…">
              שליחת סקר עכשיו
            </PendingButton>
            <FormProgress ops={{ default: { label: "שולחים את הסקר לערוץ", expectedMs: 2500 } }} />
          </form>
        </div>
        {polls === null ? (
          <p className="text-muted">לא הצלחנו לטעון את הסקרים. ודאו שהמיגרציה של הסקרים הוחלה.</p>
        ) : !polls.length ? (
          <p className={`${card} p-5 text-muted`}>עוד לא נשלח סקר.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {polls.map((p) => (
              <PollResult key={p.poll_id} poll={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
