"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The confirmation after an admin action (?status=…). The action's redirect takes away the form
 * or the list row whose button had focus, so focus falls to <body> and the next Tab would start
 * from the top: it moves here instead, so keyboard users continue from the message. Checked after
 * every render, because a second action with the same result lands on the same URL and does not
 * remount this.
 */
export function StatusMessage({ children }: { children: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  });
  return (
    <p
      ref={ref}
      role="status"
      tabIndex={-1}
      className="flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 font-semibold text-accent-ink"
    >
      <CircleCheck aria-hidden className="size-5 shrink-0" />
      {children}
    </p>
  );
}
