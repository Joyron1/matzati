"use client";

// Progress for admin actions that wait on the server (owner request 2026-10-24: every button whose
// action takes a few seconds shows a bar with what is happening and about how long is left).
// - ProgressBar: a determinate bar (an upload's real percent) or an estimate.
// - FormProgress: inside a <form> whose action is a server action; while it is pending (after a
//   short delay, so a quick save does not flash) it shows the bar for the button that was pressed:
//   buttons carry name="op" value="<key>", and `ops` says each one's label and usual duration. The
//   bar moves toward 95% over that time (never claims done before the answer), then the page's
//   status message says how it went.
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export function ProgressBar({
  value,
  label,
  detail,
}: {
  /** 0-100. */
  value: number;
  label: string;
  /** A short line after the label: "45%", "עוד כ־10 שניות". */
  detail?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="w-full max-w-xl space-y-1.5" role="status" aria-live="polite">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-gradient-to-l from-cta-from to-cta-to transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="flex justify-between gap-3 text-sm text-muted">
        <span className="font-semibold text-ink">{label}</span>
        {detail && <bdi className="shrink-0">{detail}</bdi>}
      </p>
    </div>
  );
}

/**
 * A percent that moves toward 95 over about `expectedMs` while `active` (0 otherwise), the time
 * left and the time since it started.
 */
export function useEstimate(
  active: boolean,
  expectedMs: number,
): { pct: number; leftMs: number; elapsedMs: number } {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - t0), 200);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [active]);
  if (!active) return { pct: 0, leftMs: expectedMs, elapsedMs: 0 };
  // Linear to 85% at the expected time, then slower toward 95%.
  const pct =
    elapsed <= expectedMs
      ? (elapsed / expectedMs) * 85
      : 85 + 10 * (1 - Math.exp(-(elapsed - expectedMs) / expectedMs));
  return { pct, leftMs: Math.max(0, expectedMs - elapsed), elapsedMs: elapsed };
}

/** "עוד כ־N שניות" while time is left, then "עוד רגע". */
export function timeLeft(leftMs: number): string {
  const s = Math.ceil(leftMs / 1000);
  if (s <= 1) return "עוד רגע…";
  return `עוד כ־${s} שניות`;
}

export interface Op {
  label: string;
  expectedMs: number;
}

export function FormProgress({
  ops,
  delayMs = 300,
}: {
  /** By the pressed button's value of name="op"; "default" for a button without one. */
  ops: Record<string, Op>;
  delayMs?: number;
}) {
  const status = useFormStatus();
  const key = (status.data?.get("op") as string | null) ?? "default";
  const op = ops[key] ?? ops.default;
  const { pct, leftMs, elapsedMs } = useEstimate(status.pending && !!op, op?.expectedMs ?? 1000);
  // Not for a quick answer: only once it has taken longer than delayMs.
  const shown = elapsedMs >= delayMs;
  if (!status.pending || !shown || !op) return null;
  return <ProgressBar value={pct} label={op.label} detail={timeLeft(leftMs)} />;
}

/**
 * A submit button that is busy (aria-disabled, not disabled: it keeps focus) while its form is,
 * with `busyLabel` on the pressed one. `op` names it for FormProgress; `formAction` sends the
 * form to another server action.
 */
export function PendingButton({
  className,
  children,
  op,
  busyLabel,
  formAction,
  off = false,
}: {
  className: string;
  children: React.ReactNode;
  op?: string;
  busyLabel?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  /** Not available now (e.g. the channel is not connected): shown but does nothing. */
  off?: boolean;
}) {
  const status = useFormStatus();
  const pressed = (status.data?.get("op") as string | null) ?? undefined;
  const mine = status.pending && pressed === op;
  return (
    <button
      type="submit"
      name={op ? "op" : undefined}
      value={op}
      formAction={formAction}
      aria-disabled={status.pending || off}
      onClick={(e) => {
        if (status.pending || off) e.preventDefault();
      }}
      className={`${className} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
    >
      {mine && busyLabel ? busyLabel : children}
    </button>
  );
}
