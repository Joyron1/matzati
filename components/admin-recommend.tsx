"use client";

// "הוספה למומלצים" on a product page, for the signed-in admin only (owner request 2026-10-27): adds
// the product to "המומלצים שלנו" and queues it for the Telegram channel at the end of the queue
// (owner request 2026-10-28: after every post already scheduled), with a progress bar and the slot
// it got. Renders nothing for visitors and makes no request for them: it asks the server only when
// the admin hint cookie is set (written by the admin panel, app/admin/admin-nav.tsx; it holds no
// secret, the server checks the admin itself).
import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { ProgressBar, timeLeft, useEstimate } from "@/app/admin/progress";
import { slotLabel } from "@/lib/agents/schedule";
import { btnPrimary, btnSm } from "./styles";

export const ADMIN_HINT_COOKIE = "mz_admin";

type State = "none" | "pending" | "approved" | "scheduled" | "posted" | "rejected";

const RESULT: Record<string, { ok: boolean; text: string }> = {
  scheduled: { ok: true, text: "נוסף למומלצים ונכנס לסוף התור בטלגרם" },
  off: {
    ok: true,
    text: "נוסף למומלצים. הפרסום בטלגרם כבוי בפאנל, אז הוא לא נכנס לתור.",
  },
  "not-connected": { ok: true, text: "נוסף למומלצים. הערוץ בטלגרם עוד לא מחובר, אז לא תוזמן." },
  already: { ok: false, text: "המוצר הזה כבר פורסם בטלגרם." },
  missing: { ok: false, text: "לא מצאנו את המוצר. נסו שוב בעוד רגע." },
  "not-production": { ok: false, text: "זה עובד רק באתר החי." },
  error: { ok: false, text: "משהו השתבש. נסו שוב." },
};

/** "יום ה׳ 10:00, 29.10" for an ISO time, or null. */
function slotOf(iso: string | undefined | null): string | null {
  return iso && !Number.isNaN(Date.parse(iso)) ? slotLabel(new Date(iso)) : null;
}

export function AdminRecommend({ productId }: { productId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const { pct, leftMs } = useEstimate(busy, 20_000);

  useEffect(() => {
    if (!document.cookie.split("; ").some((c) => c === `${ADMIN_HINT_COOKIE}=1`)) return;
    let live = true;
    fetch(`/api/admin/recommend?id=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { admin?: boolean; state?: State; at?: string }) => {
        if (!live || !d.admin) return;
        setState(d.state ?? "none");
        setAt(slotOf(d.at));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [productId]);

  if (state === null) return null;

  async function add() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const r = (await res.json()) as {
        ok?: boolean;
        telegram?: string;
        at?: string;
        reason?: string;
      };
      const key = r.ok ? (r.telegram ?? "error") : (r.reason ?? "error");
      const base = RESULT[key] ?? RESULT.error;
      const slot = slotOf(r.at);
      setResult({
        ...base,
        text: key === "scheduled" && slot ? `${base.text}: ${slot}.` : base.text,
      });
      if (r.ok) {
        setState(r.telegram === "scheduled" ? "scheduled" : "approved");
        setAt(slot);
      }
    } catch {
      setResult(RESULT.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-dashed border-accent/50 bg-accent-soft/40 p-3">
      <p className="text-xs font-bold text-accent-ink">ניהול (רק אתם רואים את זה)</p>
      {state === "posted" ? (
        <p className="text-sm font-semibold text-trust">המוצר במומלצים וכבר פורסם בטלגרם.</p>
      ) : state === "scheduled" ? (
        <p className="text-sm font-semibold text-trust">
          המוצר במומלצים ומתוזמן לטלגרם{at ? `: ${at}` : ""}.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void add()}
          aria-disabled={busy}
          className={`${btnPrimary} ${btnSm} gap-1.5 aria-disabled:opacity-60`}
        >
          <Star aria-hidden className="size-4" />
          {busy
            ? "מוסיפים…"
            : state === "none"
              ? "הוספה למומלצים + תזמון לטלגרם"
              : "אישור ותזמון לטלגרם"}
        </button>
      )}
      {busy && (
        <ProgressBar
          value={pct}
          label="מושכים תמונות, כותבים פוסט ומכניסים לסוף התור"
          detail={timeLeft(leftMs)}
        />
      )}
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`text-sm font-semibold ${result.ok ? "text-trust" : "text-accent-ink"}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
