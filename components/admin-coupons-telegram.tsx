"use client";

// "שליחת הקופונים לטלגרם" on /coupons, for the signed-in admin only (owner request 2026-11-01):
// shows the message as it would go out, then sends it to the channel on a second click. Renders
// nothing for visitors and makes no request for them: it asks the server only when the admin hint
// cookie is set (the server checks the admin itself), like AdminRecommend.
import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { ADMIN_HINT_COOKIE } from "./admin-recommend";
import { btnMd, btnPrimary, btnSecondary } from "./styles";

interface Info {
  connected: boolean;
  preview?: string;
  count?: number;
  reason?: string;
}

const REASON: Record<string, string> = {
  empty: "אין כרגע קופון לכל האתר שבתוקף, אז אין מה לשלוח.",
  "too-long": "יש יותר מדי קופונים להודעה אחת בטלגרם.",
  "not-connected": "הערוץ בטלגרם עוד לא מחובר.",
  telegram: "טלגרם לא קיבל את ההודעה. נסו שוב בעוד רגע.",
  failed: "משהו השתבש. נסו שוב.",
};

export function AdminCouponsTelegram() {
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!document.cookie.split("; ").some((c) => c === `${ADMIN_HINT_COOKIE}=1`)) return;
    let live = true;
    fetch("/api/admin/coupons/telegram", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Info & { admin?: boolean }) => {
        if (live && d.admin) setInfo(d);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!info) return null;

  async function send() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/coupons/telegram", { method: "POST" });
      const r = (await res.json()) as { ok?: boolean; count?: number; reason?: string };
      setResult(
        r.ok
          ? { ok: true, text: `נשלח לערוץ בטלגרם: ${r.count} קופונים.` }
          : { ok: false, text: REASON[r.reason ?? "failed"] ?? REASON.failed },
      );
      if (r.ok) setOpen(false);
    } catch {
      setResult({ ok: false, text: REASON.failed });
    } finally {
      setBusy(false);
    }
  }

  const blocked = !info.connected
    ? REASON["not-connected"]
    : info.reason
      ? REASON[info.reason]
      : null;

  return (
    <section
      aria-label="ניהול: שליחת הקופונים לטלגרם"
      className="space-y-3 rounded-card border border-dashed border-line bg-surface-2 p-4"
    >
      <p className="text-sm font-semibold text-muted">רק אתם רואים את זה (מנהלים)</p>
      {blocked ? (
        <p className="text-ink">{blocked}</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className={`${btnPrimary} ${btnMd}`}>
          <Send aria-hidden className="size-4" />
          שליחת הקופונים לטלגרם ({info.count})
        </button>
      ) : (
        <div className="space-y-3">
          <p className="font-semibold">כך ההודעה תיראה בערוץ:</p>
          <pre
            dir="rtl"
            className="max-h-96 overflow-auto rounded-2xl bg-surface p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink"
          >
            {info.preview}
          </pre>
          <p className="text-sm text-muted">
            בטלגרם הקודים ניתנים להעתקה בלחיצה, ושני הקישורים מופיעים גם ככפתורים מתחת להודעה.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={send}
              disabled={busy}
              aria-busy={busy}
              className={`${btnPrimary} ${btnMd} disabled:opacity-60`}
            >
              <Send aria-hidden className="size-4" />
              {busy ? "שולחים…" : "שליחה לערוץ עכשיו"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className={`${btnSecondary} ${btnMd}`}
            >
              ביטול
            </button>
          </div>
        </div>
      )}
      <p role="status" className={result?.ok ? "font-semibold text-ink" : "text-ink"}>
        {result?.text}
      </p>
    </section>
  );
}
