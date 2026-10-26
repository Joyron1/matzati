"use client";

import { ChevronLeft, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A candidate that opens in a drawer from the left (owner requests 2026-10-23 and 10-27). Either a
 * list row (`row`, a real button), or a card (`card`): the whole card opens the drawer through one
 * button stretched under it, while its quick actions (`card.actions`, forms) stand above that
 * button and work without opening it. The drawer is a native modal <dialog> (focus moves into it
 * and back, Escape and the backdrop close it, the page behind is inert). `defaultOpen` reopens it
 * after an action that reloaded the page (?open=<id>). The contents are rendered on the server.
 */
export function CandidateDrawer({
  title,
  row,
  card,
  children,
  defaultOpen = false,
}: {
  title: string;
  row?: ReactNode;
  card?: { media: ReactNode; body: ReactNode; actions?: ReactNode };
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (defaultOpen && ref.current && !ref.current.open) ref.current.showModal();
  }, [defaultOpen]);

  const open = () => ref.current?.showModal();

  return (
    <>
      {card ? (
        <div className="relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface transition-shadow hover:border-muted hover:shadow-[0_4px_12px_-2px_rgba(17,24,39,0.08)] has-[[data-open-card]:focus-visible]:outline-3 has-[[data-open-card]:focus-visible]:outline-accent">
          <button
            type="button"
            data-open-card
            onClick={open}
            aria-label={`פרטים ועריכה: ${title}`}
            className="absolute inset-0 focus-visible:outline-none"
          />
          {card.media}
          <div className="flex flex-1 flex-col gap-2 p-3">
            {card.body}
            {card.actions && <div className="relative z-10 mt-auto pt-1">{card.actions}</div>}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={open}
          className="flex w-full items-center gap-3 p-3 text-start hover:bg-surface-2/60 focus-visible:bg-surface-2/60 sm:p-4"
        >
          {row}
          <ChevronLeft aria-hidden className="ms-auto size-5 shrink-0 text-muted" />
        </button>
      )}
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
