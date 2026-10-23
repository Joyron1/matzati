"use client";

import { ChevronLeft, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * One row of the queue that opens its candidate in a drawer from the left (owner request
 * 2026-10-23): the row is a real button; the drawer is a native modal <dialog> (focus moves into
 * it and back, Escape and the backdrop close it, the page behind is inert). `defaultOpen` reopens
 * it after an action that reloaded the page (?open=<id>). The contents are rendered on the server.
 */
export function CandidateDrawer({
  title,
  row,
  children,
  defaultOpen = false,
}: {
  title: string;
  row: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (defaultOpen && ref.current && !ref.current.open) ref.current.showModal();
  }, [defaultOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="flex w-full items-center gap-3 p-3 text-start hover:bg-surface-2/60 focus-visible:bg-surface-2/60 sm:p-4"
      >
        {row}
        <ChevronLeft aria-hidden className="ms-auto size-5 shrink-0 text-muted" />
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        // Close on a click on the backdrop (the dialog element itself, outside the panel).
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="fixed inset-y-0 start-auto end-0 m-0 h-dvh max-h-dvh w-full max-w-2xl overflow-y-auto bg-bg p-0 text-ink shadow-2xl backdrop:bg-black/50"
        style={{ left: 0, right: "auto" }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
          <p className="line-clamp-1 font-semibold">{title}</p>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="סגירה"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-2"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="space-y-5 p-4 sm:p-5">{children}</div>
      </dialog>
    </>
  );
}
