"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The result of an admin action (?status=…): green with a check when it worked, red with a warning
 * when it did not (owner request 2026-10-24: a clear success or failure note). The action's
 * redirect takes away the form or the list row whose button had focus, so focus falls to <body>
 * and the next Tab would start from the top: it moves here instead, so keyboard users continue
 * from the message. Checked after every render, because a second action with the same result
 * lands on the same URL and does not remount this.
 */
export function StatusMessage({
  children,
  tone = "success",
}: {
  children: string;
  tone?: "success" | "error";
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  });
  const error = tone === "error";
  const Icon = error ? CircleAlert : CircleCheck;
  return (
    <p
      ref={ref}
      role={error ? "alert" : "status"}
      tabIndex={-1}
      className={`flex items-start gap-2 rounded-[10px] border px-4 py-3 font-semibold ${
        error
          ? "border-accent/30 bg-accent-soft text-accent-ink"
          : "border-trust/30 bg-trust-soft text-trust"
      }`}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      {children}
    </p>
  );
}
