"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { btnBusy, btnMd, btnSecondary } from "@/components/styles";

interface Progress {
  progress: number;
  stage: string | null;
}

/**
 * "הרצה עכשיו" with a progress bar (owner request 2026-10-23): POST /api/admin/agents/run runs the
 * finder while the page polls GET on the same route every second for the run's percent and stage
 * (agent_runs.progress, written by the run itself). When it ends, the page refreshes to show the
 * new candidates and says how many were added.
 */
export function RunFinder() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<Progress>({ progress: 0, stage: null });
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  async function poll() {
    const res = await fetch("/api/admin/agents/run", { cache: "no-store" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (Progress & { status: string }) | null;
    // The newest run is this one while it runs; never let the bar go back.
    if (data?.status === "running") {
      setState((s) => ({
        progress: Math.max(s.progress, data.progress),
        stage: data.stage ?? s.stage,
      }));
    }
  }

  async function start() {
    if (running) return;
    setRunning(true);
    setMessage(null);
    setState({ progress: 1, stage: "מתחיל" });
    timer.current = setInterval(() => void poll(), 1000);
    try {
      const res = await fetch("/api/admin/agents/run", { method: "POST" });
      const r = (await res.json()) as { status: string; added: number; note: string | null };
      setState({ progress: 100, stage: "הסתיים" });
      setMessage(
        r.status === "failed"
          ? "הריצה נכשלה. הפרטים בטבלת הריצות."
          : r.added > 0
            ? `הריצה הסתיימה: ${r.added} מוצרים חדשים ממתינים לאישור.`
            : "הריצה הסתיימה בלי מוצרים חדשים. הריצה הבאה תסרוק קטגוריות אחרות.",
      );
    } catch {
      setMessage("הריצה נכשלה או לקחה יותר מדי זמן. בדקו את טבלת הריצות.");
    } finally {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void start()}
        aria-disabled={running}
        className={`${btnSecondary} ${btnMd} ${btnBusy}`}
      >
        <Play aria-hidden className="size-[18px]" />
        {running ? "רץ…" : "הרצה עכשיו"}
      </button>
      {(running || state.progress === 100) && (
        <div className="max-w-xl space-y-1.5">
          <div
            role="progressbar"
            aria-label="התקדמות הריצה"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.progress}
            className="h-3 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <p className="flex justify-between text-sm text-muted">
            <span>{state.stage ?? ""}</span>
            <bdi dir="ltr">{state.progress}%</bdi>
          </p>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm font-semibold text-ink">
          {message}
        </p>
      )}
      <p className="text-sm text-muted">
        סורקת 8 רשימות ומושכת תמונות ווידאו, בערך דקה. עולה בערך סנט אחד עם Haiku.
      </p>
    </div>
  );
}
