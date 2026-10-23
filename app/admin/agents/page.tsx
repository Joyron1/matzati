import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Check, Download, Send, Trash2, X } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { btnMd, btnPrimary, btnSecondary, btnSm, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { HOT_BONUS_PCT, MIN_STANDARD_PCT } from "@/lib/agents/finder/select";
import { slotLabel, TELEGRAM_SLOTS } from "@/lib/agents/schedule";
import { signedVideoUrl } from "@/lib/agents/server";
import { AGENT_MODELS, readAgentSettings } from "@/lib/agents/settings";
import { listCandidates, listRuns, type AgentRun, type Candidate } from "@/lib/agents/store";
import { formatCount, formatDateTime } from "@/lib/format";
import { hotTitle } from "@/lib/product-title";
import { firstParam } from "@/lib/search-url";
import { serviceClient } from "@/lib/supabase/server";
import { telegramConfig } from "@/lib/telegram/client";
import { inputClass } from "../settings/form-parts";
import { StatusMessage } from "../status-message";
import { approveAction, rejectAction, saveAgentSettingsAction, videoRemoveAction } from "./actions";
import { RunFinder } from "./run-finder";
import { VideoUpload } from "./video-upload";

export const metadata: Metadata = {
  title: "פאנל טלגרם", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  saved: "ההגדרות נשמרו.",
  invalid: "משהו בטופס לא תקין. נסו שוב.",
  "save-failed": "לא הצלחנו לשמור. נסו שוב.",
  approved: "המוצר אושר ומופיע עכשיו במומלצים באתר.",
  "approved-telegram-off":
    "המוצר אושר ומופיע במומלצים. לטלגרם הוא לא תוזמן: הפרסום כבוי או שהערוץ עוד לא מחובר.",
  "approve-failed": "לא הצלחנו לאשר. נסו שוב.",
  rejected: "המוצר הוסר ולא יוצע שוב.",
  "reject-failed": "לא הצלחנו להסיר. נסו שוב.",
  "video-removed": "הסרטון הוסר מהמוצר. בטלגרם תעלה התמונה.",
  "video-failed": "לא הצלחנו להסיר את הסרטון. נסו שוב.",
};

function statusText(status: string, at: string): string | null {
  if (status === "approved-scheduled") {
    return `המוצר אושר, מופיע במומלצים ותוזמן לטלגרם: ${at}.`;
  }
  return STATUS[status] ?? null;
}

const RUN_STATUS: Record<string, string> = {
  running: "רצה",
  ok: "הסתיימה",
  failed: "נכשלה",
  skipped: "דולגה",
};

/**
 * Under this a listing's price is often a bait variant's (seen in the dry run of 2026-10-19: a
 * "luxury tote" at ₪1.25 paying 90%): the queue warns before the owner approves it.
 */
const SUSPECT_PRICE_ILS = 5;

function money(usd: number) {
  return `$${usd < 0.01 && usd > 0 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** /api/admin/media: downloads an AliExpress photo or video as a file. */
function downloadHref(url: string, name: string) {
  return `/api/admin/media?${new URLSearchParams({ url, name }).toString()}`;
}

async function withVideoUrls(list: Candidate[]) {
  return Promise.all(
    list.map(async (c) => ({
      c,
      videoPreview: c.video_path ? await signedVideoUrl(c.video_path, 3600) : null,
    })),
  );
}

async function load() {
  const db = serviceClient();
  const [settings, pending, approved, runs] = await Promise.all([
    readAgentSettings(db),
    listCandidates(db, "pending", 50),
    listCandidates(db, "approved", 30),
    listRuns(db, 10),
  ]);
  return {
    ...settings,
    pending: await withVideoUrls(pending),
    approved: await withVideoUrls(approved),
    runs,
  };
}

export default async function AgentsPage({ searchParams }: PageProps<"/admin/agents">) {
  await requireAdmin();
  const params = await searchParams;
  const status = statusText(firstParam(params.status), firstParam(params.at));
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load();
  } catch (err) {
    console.error(`[admin-agents] load: ${String(err).slice(0, 300)}`);
  }
  const telegramReady = telegramConfig() !== null;

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">פאנל טלגרם</h1>
        <p className="max-w-prose text-muted">
          סוכן מציאת המוצרים סורק את רשימות המוצרים החמים של אלי אקספרס ומחפש מוצרים שהעמלה הרגילה
          שלהם <bdi dir="ltr">{MIN_STANDARD_PCT}%</bdi> ומעלה ושעוברים את הסינון שלנו (משוב
          ומכירות). לכל מוצר: התמונות והווידאו להורדה, מקום להעלות סרטון שהכנתם, ופוסט שאפשר לערוך.
          מוצר שאישרתם מופיע מיד ב
          <Link href="/recommended" className="font-semibold text-accent-ink underline">
            מומלצים
          </Link>{" "}
          ומתוזמן לערוץ הטלגרם (בשעות <bdi dir="ltr">{TELEGRAM_SLOTS.join(", ")}</bdi>, אף פעם לא
          משישי <bdi dir="ltr">17:00</bdi> עד שבת <bdi dir="ltr">19:30</bdi>).
        </p>
      </div>

      {status && <StatusMessage>{status}</StatusMessage>}

      {!data ? (
        <p className={`${card} p-5 text-muted`}>
          לא הצלחנו לטעון את הנתונים. ודאו שהמיגרציות של הסוכנים הוחלו.
        </p>
      ) : (
        <>
          <Settings settings={data.settings} telegramReady={telegramReady} />
          <Queue
            pending={data.pending}
            telegramOn={data.settings.telegramEnabled && telegramReady}
          />
          <Approved approved={data.approved} />
          <Runs runs={data.runs} />
        </>
      )}
    </div>
  );
}

function Settings({
  settings,
  telegramReady,
}: {
  settings: Awaited<ReturnType<typeof readAgentSettings>>["settings"];
  telegramReady: boolean;
}) {
  return (
    <section aria-labelledby="agent-settings" className={`${card} space-y-5 p-5 sm:p-6`}>
      <h2 id="agent-settings" className="flex items-center gap-2 font-display text-2xl">
        <Bot aria-hidden className="size-6 text-accent-ink" />
        הגדרות
      </h2>
      <form action={saveAgentSettingsAction} className="space-y-5">
        {/* Meta's switches live in its own panel (phase 2); kept here unchanged. */}
        {settings.facebookEnabled && <input type="hidden" name="facebookEnabled" value="on" />}
        {settings.instagramEnabled && <input type="hidden" name="instagramEnabled" value="on" />}
        <fieldset className="space-y-2">
          <legend className="font-semibold">המודל שכותב לסוכנים</legend>
          {AGENT_MODELS.map((m) => (
            <label key={m.id} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="model"
                value={m.id}
                defaultChecked={settings.model === m.id}
                className="size-5 accent-[var(--accent)]"
              />
              <span>
                <bdi dir="ltr">{m.label}</bdi>{" "}
                <span className="text-sm text-muted">· {m.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block max-w-xs space-y-1.5">
          <span className="font-semibold">תקציב יומי לסוכנים (בדולרים)</span>
          <input
            type="number"
            name="dailyBudgetUsd"
            min={0}
            max={20}
            step={0.1}
            defaultValue={settings.dailyBudgetUsd}
            className={inputClass}
          />
          <span className="block text-sm text-muted">
            כשהתקציב נגמר, הסוכן ממשיך למצוא מוצרים ובונה את הפוסט מהנתונים בלבד, בלי מודל.
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="finderEnabled"
            defaultChecked={settings.finderEnabled}
            className="size-5 accent-[var(--accent)]"
          />
          <span>
            <span className="font-semibold">הרצה אוטומטית</span>{" "}
            <span className="text-sm text-muted">· פעמיים ביום, עד 10 מוצרים בכל ריצה</span>
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="telegramEnabled"
            defaultChecked={settings.telegramEnabled}
            className="size-5 accent-[var(--accent)]"
          />
          <span>
            <span className="font-semibold">תזמון לטלגרם כשמאשרים</span>{" "}
            <span className="text-sm text-muted">
              ·{" "}
              {telegramReady
                ? "הערוץ מחובר"
                : "הערוץ עוד לא מחובר: צריך להגדיר TELEGRAM_BOT_TOKEN ו־TELEGRAM_CHAT_ID ב־Vercel"}
            </span>
          </span>
        </label>
        <button type="submit" className={`${btnPrimary} ${btnMd}`}>
          שמירה
        </button>
      </form>
      <div className="border-t border-line pt-5">
        <RunFinder />
      </div>
    </section>
  );
}

function Rates({ c }: { c: Candidate }) {
  const p = c.product;
  const hot = p.hotCommissionRatePct ?? null;
  return (
    <p className="text-sm">
      <span className="font-semibold">עמלה רגילה:</span>{" "}
      <bdi dir="ltr" className="font-bold">
        {p.commissionRatePct ?? "-"}%
      </bdi>
      {hot !== null && hot > (p.commissionRatePct ?? 0) && (
        <>
          {" · "}
          <span className={hot >= HOT_BONUS_PCT ? "font-semibold text-accent-ink" : "text-muted"}>
            עמלת Hot: <bdi dir="ltr">{hot}%</bdi> (לא מאומת)
          </span>
        </>
      )}
    </p>
  );
}

function ProductFacts({ c }: { c: Candidate }) {
  const p = c.product;
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <div className="flex gap-1">
        <dt>מחיר:</dt>
        <dd className="text-ink">
          <bdi dir="ltr">₪{p.price}</bdi>
          {p.originalPrice && p.originalPrice > p.price && (
            <>
              {" "}
              במקום <bdi dir="ltr">₪{p.originalPrice}</bdi>
            </>
          )}
        </dd>
      </div>
      <div className="flex gap-1">
        <dt>משוב:</dt>
        <dd className="text-ink">
          <bdi dir="ltr">{p.positiveFeedbackPct ?? "-"}%</bdi>
        </dd>
      </div>
      <div className="flex gap-1">
        <dt>נמכרו ב־30 יום:</dt>
        <dd className="text-ink">
          <bdi dir="ltr">{p.unitsSold === null ? "-" : formatCount(p.unitsSold)}</bdi>
        </dd>
      </div>
    </dl>
  );
}

/** Every photo and the AliExpress video, each downloadable as a file (for the motion video). */
function Media({ c }: { c: Candidate }) {
  const p = c.product;
  const photos = p.imageUrls.length ? p.imageUrls : [p.mainImageUrl];
  return (
    <details className="rounded-xl border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        תמונות ווידאו להורדה (<bdi dir="ltr">{photos.length}</bdi> תמונות
        {p.videoUrl ? " ווידאו" : ", אין וידאו"})
      </summary>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {photos.map((url, i) => (
          <li key={url} className="space-y-1">
            <ProductImage
              src={url}
              alt=""
              className="aspect-square w-full rounded-lg border border-line"
              iconClassName="size-6"
              sizes="120px"
            />
            <a
              href={downloadHref(url, `${c.product_id}-${i + 1}.jpg`)}
              className="flex min-h-11 items-center justify-center gap-1 text-xs font-semibold text-accent-ink underline"
            >
              <Download aria-hidden className="size-3.5" />
              הורדה
            </a>
          </li>
        ))}
      </ul>
      {p.videoUrl && (
        <a
          href={downloadHref(p.videoUrl, `${c.product_id}-video.mp4`)}
          className={`${btnSecondary} ${btnSm} mt-3 inline-flex gap-1`}
        >
          <Download aria-hidden className="size-4" />
          הורדת הווידאו של המוצר
        </a>
      )}
    </details>
  );
}

function OwnVideo({ c, preview }: { c: Candidate; preview: string | null }) {
  return (
    <div className="space-y-2">
      {preview && (
        <div className="flex items-start gap-3">
          <video
            src={preview}
            controls
            preload="metadata"
            className="h-40 rounded-lg border border-line bg-black"
          />
          <form action={videoRemoveAction}>
            <input type="hidden" name="id" value={c.id} />
            <button type="submit" className={`${btnSecondary} ${btnSm} gap-1`}>
              <Trash2 aria-hidden className="size-4" />
              הסרה
            </button>
          </form>
        </div>
      )}
      <VideoUpload candidateId={c.id} hasVideo={Boolean(c.video_path)} />
    </div>
  );
}

function Queue({
  pending,
  telegramOn,
}: {
  pending: { c: Candidate; videoPreview: string | null }[];
  telegramOn: boolean;
}) {
  return (
    <section aria-labelledby="queue" className="space-y-4">
      <h2 id="queue" className="font-display text-2xl">
        ממתינים לאישור <span className="text-muted">({pending.length})</span>
      </h2>
      {!pending.length ? (
        <p className={`${card} p-5 text-muted`}>
          אין כרגע מוצרים שממתינים. הסוכן ימצא חדשים בריצה הבאה, או לחצו ״הרצה עכשיו״.
        </p>
      ) : (
        <ul className="space-y-4">
          {pending.map(({ c, videoPreview }) => (
            <li key={c.id} className={`${card} space-y-4 p-4 sm:p-5`}>
              <div className="flex gap-3">
                <ProductImage
                  src={c.product.imageUrls[0] ?? c.product.mainImageUrl}
                  alt=""
                  className="size-24 shrink-0 rounded-xl border border-line"
                  iconClassName="size-8"
                  sizes="96px"
                />
                <div className="min-w-0 space-y-1.5">
                  <Link
                    href={`/p/${encodeURIComponent(c.product_id)}`}
                    className="line-clamp-2 font-semibold underline-offset-4 hover:underline"
                  >
                    {hotTitle(c.product.title)}
                  </Link>
                  <Rates c={c} />
                  <ProductFacts c={c} />
                  {c.why_he && <p className="text-sm text-muted">{c.why_he}</p>}
                  {c.product.price < SUSPECT_PRICE_ILS && (
                    <p className="rounded-xl bg-gold-soft px-3 py-2 text-sm font-semibold text-ink">
                      מחיר נמוך מאוד: לעיתים זה המחיר של וריאציה זולה אחת (מדבקה, כיסוי) ולא של
                      המוצר בתמונה. בדקו באלי אקספרס לפני שמאשרים.
                    </p>
                  )}
                </div>
              </div>
              <Media c={c} />
              <OwnVideo c={c} preview={videoPreview} />
              <form action={approveAction} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <label className="block space-y-1">
                  <span className="text-sm font-semibold">הפוסט לטלגרם (אפשר לערוך)</span>
                  <textarea
                    name="post"
                    rows={6}
                    maxLength={1000}
                    defaultValue={c.post_he}
                    className={`${inputClass} leading-relaxed`}
                  />
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="telegram"
                    defaultChecked={telegramOn}
                    disabled={!telegramOn}
                    className="size-5 accent-[var(--accent)]"
                  />
                  <Send aria-hidden className="size-4" />
                  {telegramOn ? "לתזמן לטלגרם (לשעה הפנויה הבאה)" : "טלגרם כבוי או לא מחובר"}
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={`${btnPrimary} ${btnMd}`}>
                    <Check aria-hidden className="size-[18px]" />
                    אישור
                  </button>
                  <button
                    type="submit"
                    formAction={rejectAction}
                    className={`${btnSecondary} ${btnMd}`}
                  >
                    <X aria-hidden className="size-[18px]" />
                    לא מתאים
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function telegramNote(c: Candidate): string {
  if (c.telegram_posted_at) return ` · פורסם בטלגרם ${formatDateTime(c.telegram_posted_at)}`;
  if (c.telegram_due_at) return ` · מתוזמן לטלגרם: ${slotLabel(new Date(c.telegram_due_at))}`;
  if (c.telegram_error) return ` · טלגרם נכשל: ${c.telegram_error}`;
  return "";
}

function Approved({ approved }: { approved: { c: Candidate; videoPreview: string | null }[] }) {
  if (!approved.length) return null;
  return (
    <section aria-labelledby="approved" className="space-y-4">
      <h2 id="approved" className="font-display text-2xl">
        מאושרים <span className="text-muted">({approved.length})</span>
      </h2>
      <ul className={`${card} divide-y divide-line`}>
        {approved.map(({ c }) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <Link
                href={`/p/${encodeURIComponent(c.product_id)}`}
                className="line-clamp-1 font-semibold underline-offset-4 hover:underline"
              >
                {hotTitle(c.product.title)}
              </Link>
              <p className="text-sm text-muted">
                אושר {c.decided_at ? formatDateTime(c.decided_at) : ""} · עמלה רגילה{" "}
                <bdi dir="ltr">{c.product.commissionRatePct ?? "-"}%</bdi>
                {c.video_path ? " · עם סרטון" : ""}
                {telegramNote(c)}
              </p>
            </div>
            <form action={rejectAction}>
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" className={`${btnSecondary} ${btnMd}`}>
                הסרה מהאתר
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Runs({ runs }: { runs: AgentRun[] }) {
  return (
    <section aria-labelledby="runs" className="space-y-4">
      <h2 id="runs" className="font-display text-2xl">
        ריצות אחרונות
      </h2>
      {!runs.length ? (
        <p className={`${card} p-5 text-muted`}>עוד לא היו ריצות.</p>
      ) : (
        <div
          role="region"
          aria-labelledby="runs"
          tabIndex={0}
          className={`${card} overflow-x-auto`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-muted">
                {["מתי", "איך", "מצב", "נסרקו", "נוספו", "עלות", "הערה"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2.5 text-start font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 whitespace-nowrap">{formatDateTime(r.started_at)}</td>
                  <td className="px-3 py-2.5">{r.trigger === "cron" ? "אוטומטית" : "ידנית"}</td>
                  <td className="px-3 py-2.5">
                    {RUN_STATUS[r.status] ?? r.status}
                    {r.status === "running" && (
                      <>
                        {" "}
                        <bdi dir="ltr">{r.progress}%</bdi>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <bdi dir="ltr">{formatCount(r.scanned)}</bdi>
                  </td>
                  <td className="px-3 py-2.5">
                    <bdi dir="ltr">{formatCount(r.added)}</bdi>
                  </td>
                  <td className="px-3 py-2.5">
                    <bdi dir="ltr">{money(r.cost_usd)}</bdi>
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    <bdi dir="ltr">{r.note ?? ""}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
