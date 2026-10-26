"use client";

// "הוספה למומלצים" on a product page, for the signed-in admin only (owner request 2026-10-27): adds
// the product to "המומלצים שלנו" and posts it to the Telegram channel at once, with a progress bar
// and the result. Renders nothing for visitors and makes no request for them: it asks the server
// only when the admin hint cookie is set (written by the admin panel, app/admin/admin-nav.tsx; it
// holds no secret, the server checks the admin itself).
import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { ProgressBar, timeLeft, useEstimate } from "@/app/admin/progress";
import { btnPrimary, btnSm } from "./styles";

export const ADMIN_HINT_COOKIE = "mz_admin";

type State = "none" | "pending" | "approved" | "posted" | "rejected";

const RESULT: Record<string, { ok: boolean; text: string }> = {
  posted: { ok: true, text: "נוסף למומלצים ופורסם בטלגרם." },
  "not-connected": { ok: true, text: "נוסף למומלצים. הערוץ בטלגרם עוד לא מחובר, אז לא פורסם." },
  failed: { ok: false, text: "נוסף למומלצים, אבל הפרסום בטלגרם נכשל" },
  already: { ok: false, text: "המוצר הזה כבר פורסם בטלגרם." },
  missing: { ok: false, text: "לא מצאנו את המוצר. נסו שוב בעוד רגע." },
  "not-production": { ok: false, text: "זה עובד רק באתר החי." },
  error: { ok: false, text: "משהו השתבש. נסו שוב." },
};

export function AdminRecommend({ productId }: { productId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const { pct, leftMs } = useEstimate(busy, 25_000);

  useEffect(() => {
    if (!document.cookie.split("; ").some((c) => c === `${ADMIN_HINT_COOKIE}=1`)) return;
    let live = true;
    fetch(`/api/admin/recommend?id=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { admin?: boolean; state?: State }) => {
        if (live && d.admin) setState(d.state ?? "none");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [productId]);

  if (state === null) return null;

  async function add() {
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
        reason?: string;
        error?: string;
      };
      const key = r.ok ? (r.telegram ?? "posted") : (r.reason ?? "error");
      const base = RESULT[key] ?? RESULT.error;
      setResult({
        ...base,
        text: r.error && key === "failed" ? `${base.text}: ${r.error}` : base.text,
      });
      if (r.ok) setState(r.telegram === "posted" ? "posted" : "approved");
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
              ? "הוספה למומלצים + פרסום בטלגרם"
              : "אישור ופרסום בטלגרם"}
        </button>
      )}
      {busy && (
        <ProgressBar
          value={pct}
          label="מושכים תמונות, כותבים פוסט ושולחים לטלגרם"
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
