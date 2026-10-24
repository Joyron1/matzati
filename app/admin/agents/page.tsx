import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  Download,
  Film,
  History,
  Inbox,
  PenLine,
  Send,
  Settings2,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { btnBusy, btnMd, btnPrimary, btnSecondary, btnSm, card } from "@/components/styles";
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
import { AdminHeader, AdminTabs } from "../admin-tabs";
import { inputClass } from "../settings/form-parts";
import { StatusMessage } from "../status-message";
import {
  approveAction,
  publishNowAction,
  rejectAction,
  rewriteAction,
  saveAgentSettingsAction,
  videoRemoveAction,
} from "./actions";
import { CandidateDrawer } from "./candidate-drawer";
import { RunFinder } from "./run-finder";
import { VideoUpload } from "./video-upload";

const TABS = ["queue", "approved", "runs", "settings"] as const;
type Tab = (typeof TABS)[number];

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
  "published-now": "פורסם עכשיו בטלגרם (בלי תזמון ובלי הגבלת שבת). המוצר מאושר ומופיע במומלצים.",
  "publish-not-connected":
    "הערוץ עוד לא מחובר: צריך להגדיר TELEGRAM_BOT_TOKEN ו־TELEGRAM_CHAT_ID ב־Vercel.",
  "publish-already": "המוצר הזה כבר פורסם בטלגרם.",
  rejected: "המוצר הוסר ולא יוצע שוב.",
  "reject-failed": "לא הצלחנו להסיר. נסו שוב.",
  "video-removed": "הסרטון הוסר מהמוצר. בטלגרם תעלה התמונה.",
  "video-failed": "לא הצלחנו להסיר את הסרטון. נסו שוב.",
  rewritten: "הפוסט נכתב מחדש.",
  "rewrite-failed":
    "לא הצלחנו לכתוב את הפוסט מחדש (המודל לא ענה או שהטקסט לא עבר את הבדיקות). אפשר לנסות שוב או לערוך ידנית.",
};

function statusText(status: string, at: string, err = ""): string | null {
  if (status === "publish-failed") {
    return `הפרסום בטלגרם נכשל${err ? `: ${err}` : "."} נסו שוב.`;
  }
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
  const status = statusText(
    firstParam(params.status),
    firstParam(params.at),
    firstParam(params.err),
  );
  // Reopens the candidate's drawer after an action that reloaded the page.
  const openId = firstParam(params.open);
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load();
  } catch (err) {
    console.error(`[admin-agents] load: ${String(err).slice(0, 300)}`);
  }
  const telegramReady = telegramConfig() !== null;
  const tabParam = firstParam(params.tab);
  // A reopened drawer is in the queue.
  const tab: Tab =
    !openId && (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "queue";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-8 sm:px-6 sm:pt-12">
      <AdminHeader
        title="טלגרם"
        subtitle={
          <>
            הסוכן מוצא מוצרים עם עמלה רגילה של <bdi dir="ltr">{MIN_STANDARD_PCT}%</bdi> ומעלה שעברו
            את הסינון. מאשרים, והם עולים ל
            <Link href="/recommended" className="font-semibold text-accent-ink underline">
              מומלצים
            </Link>{" "}
            ולערוץ.
          </>
        }
      >
        <RunFinder />
      </AdminHeader>

      {status && <StatusMessage>{status}</StatusMessage>}

      {!data ? (
        <p className={`${card} p-5 text-muted`}>
          לא הצלחנו לטעון את הנתונים. ודאו שהמיגרציות של הסוכנים הוחלו.
        </p>
      ) : (
        <>
          <StatusChips settings={data.settings} telegramReady={telegramReady} />
          <AdminTabs
            label="חלקי פאנל הטלגרם"
            base="/admin/agents"
            current={tab}
            tabs={[
              { key: "queue", label: "ממתינים", icon: Inbox, count: data.pending.length },
              {
                key: "approved",
                label: "מאושרים",
                icon: CheckCircle2,
                count: data.approved.length,
              },
              { key: "runs", label: "ריצות", icon: History },
              { key: "settings", label: "הגדרות", icon: Settings2 },
            ]}
          />
          {tab === "queue" && (
            <Queue
              pending={data.pending}
              telegramOn={data.settings.telegramEnabled && telegramReady}
              telegramReady={telegramReady}
              openId={openId}
            />
          )}
          {tab === "approved" && (
            <Approved approved={data.approved} telegramReady={telegramReady} />
          )}
          {tab === "runs" && <Runs runs={data.runs} />}
          {tab === "settings" && (
            <Settings settings={data.settings} telegramReady={telegramReady} />
          )}
        </>
      )}
    </div>
  );
}

/** One line of what is on: the channel, the automatic run, the shipping filter, the budget. */
function StatusChips({
  settings,
  telegramReady,
}: {
  settings: Awaited<ReturnType<typeof readAgentSettings>>["settings"];
  telegramReady: boolean;
}) {
  const model = AGENT_MODELS.find((m) => m.id === settings.model)?.label ?? settings.model;
  const chips: { on: boolean; text: string }[] = [
    { on: telegramReady, text: telegramReady ? "הערוץ מחובר" : "הערוץ לא מחובר" },
    {
      on: settings.telegramEnabled,
      text: settings.telegramEnabled ? "תזמון לטלגרם פעיל" : "תזמון לטלגרם כבוי",
    },
    {
      on: settings.finderEnabled,
      text: settings.finderEnabled ? "הרצה אוטומטית פעמיים ביום" : "הרצה אוטומטית כבויה",
    },
    {
      on: settings.freeShippingOnly,
      text: settings.freeShippingOnly ? "משלוח חינם בלבד" : "כל המשלוחים",
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {chips.map((c) => {
        const Icon = c.on ? CheckCircle2 : CircleDashed;
        return (
          <span
            key={c.text}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${
              c.on ? "bg-trust-soft text-trust" : "bg-surface-2 text-muted"
            }`}
          >
            <Icon aria-hidden className="size-4" />
            {c.text}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 font-semibold text-muted">
        <Bot aria-hidden className="size-4" />
        <bdi dir="ltr">{model}</bdi> · עד <bdi dir="ltr">${settings.dailyBudgetUsd}</bdi> ליום
      </span>
      <Link
        href="/admin/agents?tab=settings"
        className="inline-flex min-h-11 items-center px-2 font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        שינוי
      </Link>
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
      <h2 id="agent-settings" className="flex items-center gap-2 text-xl font-bold">
        <Bot aria-hidden className="size-5 text-accent" />
        הגדרות הסוכן
      </h2>
      <p className="text-sm text-muted">
        פוסטים מתוזמנים יוצאים בשעות <bdi dir="ltr">{TELEGRAM_SLOTS.join(", ")}</bdi>, אף פעם לא
        משישי <bdi dir="ltr">17:00</bdi> עד שבת <bdi dir="ltr">19:30</bdi>.
      </p>
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
            name="freeShippingOnly"
            defaultChecked={settings.freeShippingOnly}
            className="size-5 accent-[var(--accent)]"
          />
          <span>
            <span className="font-semibold">משלוח חינם לישראל בלבד</span>{" "}
            <span className="text-sm text-muted">
              · נבדק מול אלי אקספרס לכל מוצר (לגרסה הבסיסית שלו), עד 14 בדיקות בריצה
            </span>
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
      <div className="flex gap-1">
        <dt>משלוח לישראל:</dt>
        <dd className="text-ink">
          {!p.shipping ? (
            "לא נבדק"
          ) : (
            <>
              {p.shipping.feeIls === 0 ? "חינם" : <bdi dir="ltr">₪{p.shipping.feeIls}</bdi>}
              {p.shipping.minDays !== null && p.shipping.maxDays !== null && (
                <>
                  {" "}
                  ·{" "}
                  <bdi dir="ltr">
                    {p.shipping.minDays}-{p.shipping.maxDays}
                  </bdi>{" "}
                  ימים
                </>
              )}
            </>
          )}
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

/** The row of the queue: photo, title, rates, price, and what the drawer holds. */
function Row({ c }: { c: Candidate }) {
  const p = c.product;
  return (
    <>
      <ProductImage
        src={p.imageUrls[0] ?? p.mainImageUrl}
        alt=""
        className="size-16 shrink-0 rounded-xl border border-line"
        iconClassName="size-6"
        sizes="64px"
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="line-clamp-1 font-semibold">{hotTitle(p.title)}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
          <span>
            רגילה{" "}
            <bdi dir="ltr" className="font-bold text-ink">
              {p.commissionRatePct ?? "-"}%
            </bdi>
          </span>
          {p.hotCommissionRatePct != null &&
            p.hotCommissionRatePct > (p.commissionRatePct ?? 0) && (
              <span>
                Hot <bdi dir="ltr">{p.hotCommissionRatePct}%</bdi>
              </span>
            )}
          <bdi dir="ltr">₪{p.price}</bdi>
          <span>
            <bdi dir="ltr">{p.unitsSold === null ? "-" : formatCount(p.unitsSold)}</bdi> נמכרו
          </span>
          {p.videoUrl && (
            <span className="inline-flex items-center gap-1">
              <Film aria-hidden className="size-3.5" /> וידאו
            </span>
          )}
          {p.shipping?.feeIls === 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-ink">
              <Truck aria-hidden className="size-3.5" /> משלוח חינם
            </span>
          )}
          {c.video_path && <span className="font-semibold text-accent-ink">סרטון שלך הועלה</span>}
          {p.price < SUSPECT_PRICE_ILS && (
            <span className="font-semibold text-ink">⚠ מחיר חשוד</span>
          )}
        </span>
      </span>
    </>
  );
}

function Queue({
  pending,
  telegramOn,
  telegramReady,
  openId,
}: {
  pending: { c: Candidate; videoPreview: string | null }[];
  telegramOn: boolean;
  telegramReady: boolean;
  openId: string;
}) {
  return (
    <section aria-labelledby="queue" className="space-y-4">
      <h2 id="queue" className="sr-only">
        ממתינים לאישור ({pending.length})
      </h2>
      {!pending.length ? (
        <p className={`${card} p-5 text-muted`}>
          אין כרגע מוצרים שממתינים. הסוכן ימצא חדשים בריצה הבאה, או לחצו ״הרצה עכשיו״.
        </p>
      ) : (
        <ul className={`${card} divide-y divide-line overflow-hidden`}>
          {pending.map(({ c, videoPreview }) => (
            <li key={c.id}>
              <CandidateDrawer
                title={hotTitle(c.product.title)}
                row={<Row c={c} />}
                defaultOpen={openId === c.id}
              >
                <div className="flex gap-3">
                  <ProductImage
                    src={c.product.imageUrls[0] ?? c.product.mainImageUrl}
                    alt=""
                    className="size-28 shrink-0 rounded-xl border border-line"
                    iconClassName="size-8"
                    sizes="112px"
                  />
                  <div className="min-w-0 space-y-1.5">
                    <Link
                      href={`/p/${encodeURIComponent(c.product_id)}`}
                      target="_blank"
                      className="line-clamp-3 font-semibold underline-offset-4 hover:underline"
                    >
                      {hotTitle(c.product.title)}
                    </Link>
                    <Rates c={c} />
                    <ProductFacts c={c} />
                    {c.why_he && <p className="text-sm text-muted">{c.why_he}</p>}
                  </div>
                </div>
                {c.product.price < SUSPECT_PRICE_ILS && (
                  <p className="rounded-xl bg-gold-soft px-3 py-2 text-sm font-semibold text-ink">
                    מחיר נמוך מאוד: לעיתים זה המחיר של וריאציה זולה אחת (מדבקה, כיסוי) ולא של המוצר
                    בתמונה. בדקו באלי אקספרס לפני שמאשרים.
                  </p>
                )}
                <Media c={c} />
                <section aria-label="סרטון לפרסום" className="space-y-2">
                  <h3 className="font-semibold">סרטון לפרסום</h3>
                  <OwnVideo c={c} preview={videoPreview} />
                </section>
                <form action={approveAction} className="space-y-3">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="block space-y-1">
                    <span className="font-semibold">הפוסט לטלגרם (אפשר לערוך)</span>
                    <textarea
                      name="post"
                      rows={12}
                      maxLength={1000}
                      defaultValue={c.post_he}
                      className={`${inputClass} leading-relaxed`}
                    />
                  </label>
                  <p className="text-xs text-muted">
                    השורה ״🔗 קישור לקנייה״ מתחלפת בקישור לקנייה כשהפוסט נשלח לטלגרם.
                  </p>
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
                      formAction={publishNowAction}
                      aria-disabled={!telegramReady}
                      className={`${btnSecondary} ${btnMd} ${btnBusy}`}
                    >
                      <Send aria-hidden className="size-[18px]" />
                      פרסום עכשיו
                    </button>
                    <button
                      type="submit"
                      formAction={rewriteAction}
                      className={`${btnSecondary} ${btnMd}`}
                    >
                      <PenLine aria-hidden className="size-[18px]" />
                      כתיבה מחדש
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
                  <details className="text-xs text-muted">
                    <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                      מה עושה כל כפתור?
                    </summary>
                    <p>
                      ״אישור״ מעלה למומלצים ומתזמן לשעה הפנויה הבאה. ״פרסום עכשיו״ מאשר ושולח לטלגרם
                      מיד, בלי תזמון ובלי הגבלת שישי־שבת (לבדיקות). ״כתיבה מחדש״ כותבת את הפוסט שוב
                      עם המודל שבחרתם, כולל הקופונים שבתוקף (בערך סנט אחד), ומבטלת שינויים שעשיתם
                      בטקסט. ״לא מתאים״ מסיר את המוצר והוא לא יוצע שוב.
                    </p>
                  </details>
                </form>
              </CandidateDrawer>
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

function Approved({
  approved,
  telegramReady,
}: {
  approved: { c: Candidate; videoPreview: string | null }[];
  telegramReady: boolean;
}) {
  if (!approved.length) {
    return <p className={`${card} p-5 text-muted`}>עוד אין מוצרים מאושרים.</p>;
  }
  return (
    <section aria-labelledby="approved" className="space-y-4">
      <h2 id="approved" className="sr-only">
        מאושרים ({approved.length})
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
            <div className="flex flex-wrap gap-2">
              {telegramReady && !c.telegram_posted_at && (
                <form action={publishNowAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className={`${btnSecondary} ${btnMd}`}>
                    <Send aria-hidden className="size-[18px]" />
                    פרסום עכשיו
                  </button>
                </form>
              )}
              <form action={rejectAction}>
                <input type="hidden" name="id" value={c.id} />
                <button type="submit" className={`${btnSecondary} ${btnMd}`}>
                  הסרה מהאתר
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Runs({ runs }: { runs: AgentRun[] }) {
  return (
    <section aria-labelledby="runs" className="space-y-4">
      <h2 id="runs" className="sr-only">
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
