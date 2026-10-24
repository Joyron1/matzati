"use client";

// The phone header's menu (owner request 2026-10-24: one clear hamburger menu instead of a row of
// icons). Below lg the header shows the logo, the saved-products heart and this button; the button
// opens a side sheet from the start side (the right, RTL) as a native modal <dialog>: focus moves
// in and back, Escape and a tap on the backdrop close it, and so does following any of its links
// or any navigation. Its content is rendered on the server (components/site-header.tsx) and passed
// in as children. From lg the header's own links show and this button is hidden.
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "./logo";

export function MobileMenu({ children, brand }: { children: ReactNode; brand: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const id = useId();

  // Any navigation closes it (the dialog's close event updates `open`).
  useEffect(() => {
    if (ref.current?.open) ref.current.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        aria-label="תפריט"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          ref.current?.showModal();
          setOpen(true);
        }}
        className="grid size-11 place-items-center rounded-full text-ink hover:bg-surface-2 lg:hidden"
      >
        <Menu aria-hidden className="size-6" />
      </button>
      <dialog
        ref={ref}
        id={id}
        aria-label="תפריט"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A tap on the backdrop (the dialog itself, outside its panel) or on a link closes it.
          if (e.target === e.currentTarget) ref.current?.close();
          else if ((e.target as Element).closest("a")) ref.current?.close();
        }}
        className="mobile-menu fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-none w-[min(22rem,88vw)] max-w-none overflow-hidden bg-surface p-0 text-ink shadow-soft backdrop:bg-ink/45 lg:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-line ps-4 pe-2">
            <span className="flex items-center gap-2 font-display text-xl">
              <LogoMark className="size-8" />
              {brand}
            </span>
            <button
              type="button"
              aria-label="סגירת התפריט"
              onClick={() => ref.current?.close()}
              className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </dialog>
    </>
  );
}
