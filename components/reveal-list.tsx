"use client";

import { useState, type ReactNode } from "react";
import { btnMd, btnSecondary } from "./styles";

/**
 * A list shown `initial` items at a time, `step` more per click (the simple search's cards, owner
 * request 2026-10-19). The items are rendered on the server; only how many are shown changes. The
 * button keeps the focus, and a polite status says how many are shown.
 */
export function RevealList({
  items,
  initial,
  step,
  className,
  noun = "מוצרים",
}: {
  items: ReactNode[];
  initial: number;
  step: number;
  className?: string;
  /** What the items are, for the button and the status ("עוד 10 מוצרים"). */
  noun?: string;
}) {
  const [shown, setShown] = useState(Math.min(initial, items.length));
  const next = Math.min(step, items.length - shown);
  return (
    <div className="space-y-4">
      <ul className={className}>{items.slice(0, shown)}</ul>
      <div className="flex flex-col items-center gap-2">
        {next > 0 && (
          <button
            type="button"
            onClick={() => setShown((n) => Math.min(n + step, items.length))}
            className={`${btnSecondary} ${btnMd}`}
          >
            עוד <bdi dir="ltr">{next}</bdi> {noun}
          </button>
        )}
        <p role="status" className="text-sm text-muted">
          מוצגים <bdi dir="ltr">{shown}</bdi> מתוך <bdi dir="ltr">{items.length}</bdi>
        </p>
      </div>
    </div>
  );
}
