import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Check, Play, Send, X } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { btnMd, btnPrimary, btnSecondary, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { MIN_COMMISSION_PCT } from "@/lib/agents/finder/select";
import { AGENT_MODELS, readAgentSettings } from "@/lib/agents/settings";
import { listCandidates, listRuns, type AgentRun, type Candidate } from "@/lib/agents/store";
import { formatCount, formatDateTime } from "@/lib/format";
import { hotTitle } from "@/lib/product-title";
import { firstParam } from "@/lib/search-url";
import { serviceClient } from "@/lib/supabase/server";
import { metaConfig } from "@/lib/meta/publish";
import { telegramConfig } from "@/lib/telegram/client";
import { inputClass } from "../settings/form-parts";
import { StatusMessage } from "../status-message";
import { approveAction, rejectAction, runFinderAction, saveAgentSettingsAction } from "./actions";

export const metadata: Metadata = {
  title: "סוכנים", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

// A run can take most of a minute (8 AliExpress lists and one writer call).
export const maxDuration = 60;

const STATUS: Record<string, string> = {
  saved: "ההגדרות נשמרו.",
  invalid: "משהו בטופס לא תקין. נסו שוב.",
  "save-failed": "לא הצלחנו לשמור. נסו שוב.",
  "run-failed": "הריצה נכשלה. הפרטים בטבלת הריצות.",
  approved: "המוצר אושר ומופיע עכשיו במומלצים באתר.",
  "approved-channels": "המוצר אושר, מופיע במומלצים ופורסם בערוצים שבחרתם.",
  "approved-channel-off":
    "המוצר אושר ומופיע במומלצים. חלק מהערוצים שבחרתם כבויים או עוד לא מחוברים, ושם הוא לא פורסם.",
  "approved-channel-failed":
    "המוצר אושר ומופיע במומלצים, אבל הפרסום באחד הערוצים נכשל. הסיבה מופיעה ברשימת המאושרים.",
  "approve-failed": "לא הצלחנו לאשר. נסו שוב.",
  rejected: "המוצר הוסר מהרשימה ולא יוצע שוב.",
  "reject-failed": "לא הצלחנו להסיר. נסו שוב.",
};

function statusText(status: string): string | null {
  if (STATUS[status]) return STATUS[status];
  const run = /^run-(\d+)$/.exec(status);
  if (run) {
    return Number(run[1]) > 0
      ? `הריצה הסתיימה: ${run[1]} מוצרים חדשים ממתינים לאישור.`
      : "הריצה הסתיימה בלי מוצרים חדשים. ריצה הבאה תסרוק קטגוריות אחרות.";
  }
  return null;
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

async function load() {
  const db = serviceClient();
  const [settings, pending, approved, runs] = await Promise.all([
    readAgentSettings(db),
    listCandidates(db, "pending", 50),
    listCandidates(db, "approved", 30),
    listRuns(db, 10),
  ]);
  return { ...settings, pending, approved, runs };
}

export default async function AgentsPage({ searchParams }: PageProps<"/admin/agents">) {
  await requireAdmin();
  const status = statusText(firstParam((await searchParams).status));
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load();
  } catch (err) {
    console.error(`[admin-agents] load: ${String(err).slice(0, 300)}`);
  }
  const meta = metaConfig();
  const ready: Ready = {
    telegram: telegramConfig() !== null,
    facebook: meta !== null,
    instagram: meta?.igUserId != null,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">סוכנים</h1>
        <p className="max-w-prose text-muted">
          סוכן מציאת המוצרים סורק את רשימות המוצרים החמים של אלי אקספרס ומחפש מוצרים שמשלמים עמלה של{" "}
          {MIN_COMMISSION_PCT}% ומעלה ועוברים את הסינון שלנו (משוב ומכירות). הוא כותב לכל אחד פוסט,
          והם מחכים כאן לאישור שלכם. מוצר שאישרתם מופיע ב
          <Link href="/recommended" className="font-semibold text-accent-ink underline">
            מומלצים
          </Link>{" "}
          ובדף הבית, ואם תבחרו, גם בטלגרם, בעמוד הפייסבוק ובאינסטגרם. שום דבר לא מתפרסם בלי אישור
          שלכם.
        </p>
      </div>

      {status && <StatusMessage>{status}</StatusMessage>}

      {!data ? (
        <p className={`${card} p-5 text-muted`}>
          לא הצלחנו לטעון את הנתונים. אם זו הפעם הראשונה, ודאו שהמיגרציה{" "}
          <bdi dir="ltr" className="font-mono">
            20261019120000_agents
          </bdi>{" "}
          הוחלה.
        </p>
      ) : (
        <>
          <Settings settings={data.settings} ready={ready} />
          <Queue
            pending={data.pending}
            on={{
              telegram: data.settings.telegramEnabled && ready.telegram,
              facebook: data.settings.facebookEnabled && ready.facebook,
              instagram: data.settings.instagramEnabled && ready.instagram,
            }}
          />
          <Approved approved={data.approved} />
          <Runs runs={data.runs} />
        </>
      )}
    </div>
  );
}

/** Which channels are configured in Vercel (their variables are set). */
interface Ready {
  telegram: boolean;
  facebook: boolean;
  instagram: boolean;
}

const CHANNELS = [
  {
    key: "telegram",
    setting: "telegramEnabled",
    label: "פרסום בטלגרם כשמאשרים",
    short: "טלגרם",
    missing: "צריך להגדיר TELEGRAM_BOT_TOKEN ו־TELEGRAM_CHAT_ID ב־Vercel",
  },
  {
    key: "facebook",
    setting: "facebookEnabled",
    label: "פרסום בעמוד הפייסבוק כשמאשרים",
    short: "פייסבוק",
    missing: "צריך להגדיר META_PAGE_ID ו־META_PAGE_ACCESS_TOKEN ב־Vercel",
  },
  {
    key: "instagram",
    setting: "instagramEnabled",
    label: "פרסום באינסטגרם כשמאשרים",
    short: "אינסטגרם",
    missing: "צריך להגדיר גם META_IG_USER_ID ב־Vercel",
  },
] as const;

function Settings({
  settings,
  ready,
}: {
  settings: Awaited<ReturnType<typeof readAgentSettings>>["settings"];
  ready: Ready;
}) {
  return (
    <section aria-labelledby="agent-settings" className={`${card} space-y-5 p-5 sm:p-6`}>
      <h2 id="agent-settings" className="flex items-center gap-2 font-display text-2xl">
        <Bot aria-hidden className="size-6 text-accent-ink" />
        הגדרות
      </h2>
      <form action={saveAgentSettingsAction} className="space-y-5">
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
        {CHANNELS.map((ch) => (
          <label key={ch.key} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              name={ch.setting}
              defaultChecked={settings[ch.setting]}
              className="size-5 accent-[var(--accent)]"
            />
            <span>
              <span className="font-semibold">{ch.label}</span>{" "}
              <span className="text-sm text-muted">
                · {ready[ch.key] ? "מחובר" : `עוד לא מחובר: ${ch.missing}`}
              </span>
            </span>
          </label>
        ))}
        <button type="submit" className={`${btnPrimary} ${btnMd}`}>
          שמירה
        </button>
      </form>
      <form action={runFinderAction} className="border-t border-line pt-5">
        <button type="submit" className={`${btnSecondary} ${btnMd}`}>
          <Play aria-hidden className="size-[18px]" />
          הרצה עכשיו
        </button>
        <p className="mt-2 text-sm text-muted">
          סורקת 8 רשימות (בערך דקה). עולה כמו ריצה רגילה: בערך סנט אחד עם Haiku.
        </p>
      </form>
    </section>
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
        <dt>עמלה:</dt>
        <dd className="font-bold text-ink">
          <bdi dir="ltr">{c.commission_pct}%</bdi>
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

function Queue({ pending, on }: { pending: Candidate[]; on: Ready }) {
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
        <ul className="grid gap-4 lg:grid-cols-2">
          {pending.map((c) => (
            <li key={c.id} className={`${card} space-y-3 p-4`}>
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
              <form action={approveAction} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <label className="block space-y-1">
                  <span className="text-sm font-semibold">הפוסט (אפשר לערוך)</span>
                  <textarea
                    name="post"
                    rows={5}
                    maxLength={1000}
                    defaultValue={c.post_he}
                    className={`${inputClass} leading-relaxed`}
                  />
                </label>
                <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
                  <legend className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    <Send aria-hidden className="size-4" />
                    לפרסם גם ב:
                  </legend>
                  {CHANNELS.map((ch) => (
                    <label key={ch.key} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={ch.key}
                        defaultChecked={on[ch.key]}
                        disabled={!on[ch.key]}
                        className="size-5 accent-[var(--accent)]"
                      />
                      {ch.short}
                      {!on[ch.key] && <span className="text-muted">(כבוי)</span>}
                    </label>
                  ))}
                </fieldset>
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

function channelNote(name: string, postedAt: string | null, error: string | null): string {
  if (postedAt) return ` · פורסם ב${name}`;
  if (error) return ` · ${name} נכשל: ${error}`;
  return "";
}

function Approved({ approved }: { approved: Candidate[] }) {
  if (!approved.length) return null;
  return (
    <section aria-labelledby="approved" className="space-y-4">
      <h2 id="approved" className="font-display text-2xl">
        במומלצים באתר <span className="text-muted">({approved.length})</span>
      </h2>
      <ul className={`${card} divide-y divide-line`}>
        {approved.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <Link
                href={`/p/${encodeURIComponent(c.product_id)}`}
                className="line-clamp-1 font-semibold underline-offset-4 hover:underline"
              >
                {hotTitle(c.product.title)}
              </Link>
              <p className="text-sm text-muted">
                אושר {c.decided_at ? formatDateTime(c.decided_at) : ""} · עמלה{" "}
                <bdi dir="ltr">{c.commission_pct}%</bdi>
                {channelNote("טלגרם", c.telegram_posted_at, c.telegram_error)}
                {channelNote("פייסבוק", c.facebook_posted_at, c.facebook_error)}
                {channelNote("אינסטגרם", c.instagram_posted_at, c.instagram_error)}
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
                  <td className="px-3 py-2.5">{RUN_STATUS[r.status] ?? r.status}</td>
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
