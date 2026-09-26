"use client";

import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { btnLg, btnSecondary } from "./styles";

/** Reveals the next batch of results and moves focus to it. */
export function ShowMore({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${btnSecondary} ${btnLg} w-full sm:w-auto`}
      >
        <Plus aria-hidden className="size-5" />
        {label}
      </button>
    );
  }

  return (
    <section
      aria-label={label}
      tabIndex={-1}
      ref={(el) => el?.focus()}
      className="rounded-card outline-none"
    >
      {children}
    </section>
  );
}
