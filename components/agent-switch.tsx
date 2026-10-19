"use client";

import { Sparkles } from "lucide-react";
import { useId, useState } from "react";

/**
 * "סוכן חכם" on or off for the search form it sits in (owner request 2026-10-19). On (the default)
 * the form searches as always; off it adds mode=simple, the simple search (what AliExpress returns,
 * unfiltered). A real switch (role="switch", aria-checked) with a visible label and a line that says
 * what the current choice does. Without JavaScript the form searches with the agent, the default.
 */
export function AgentSwitch({
  defaultOn = true,
  className = "",
}: {
  defaultOn?: boolean;
  className?: string;
}) {
  const [on, setOn] = useState(defaultOn);
  const labelId = useId();
  const noteId = useId();
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {!on && <input type="hidden" name="mode" value="simple" />}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={noteId}
        onClick={() => setOn((v) => !v)}
        // 44px hit area around a 24px track.
        className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center"
      >
        <span
          aria-hidden
          className={`relative h-6 w-11 rounded-full border transition-colors motion-reduce:transition-none ${
            on ? "border-accent bg-accent" : "border-line bg-surface-2"
          }`}
        >
          <span
            className={`absolute top-0.5 size-[18px] rounded-full bg-surface shadow-sm transition-[inset-inline-start] motion-reduce:transition-none ${
              on ? "start-[calc(100%-20px)]" : "start-0.5"
            }`}
          />
        </span>
      </button>
      <div className="min-w-0 text-start">
        <span id={labelId} className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Sparkles aria-hidden className="size-4 text-accent-ink" />
          סוכן חכם
        </span>
        <span id={noteId} className="block text-xs leading-snug text-muted">
          {on
            ? "מסנן לפי משוב ומכירות, בודק שזה בדיוק המוצר ומסביר למה בחר"
            : "כבוי: חיפוש פשוט, כל מה שאלי אקספרס מחזירה, בלי סינון"}
        </span>
      </div>
    </div>
  );
}
