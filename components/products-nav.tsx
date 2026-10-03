"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from "react";
import { useMounted } from "@/lib/use-mounted";
import { HOVER_CLOSE_DELAY_MS, NAV_MENU_CLOSED, navMenuReducer } from "./products-nav-state";

const PRODUCTS_PATH = "/products";
const LABEL = "כל המוצרים";

const navLink =
  "flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full font-medium text-muted hover:text-ink";

/**
 * The header's "כל המוצרים" item with its categories panel (`children`, rendered on the server with
 * the icons, so the panel adds no icon JavaScript). Rules in ./products-nav-state.ts.
 *
 * From lg: the "כל המוצרים" link (to /products) and a chevron button beside it. Hovering either
 * opens the panel and leaving closes it; the chevron (click, Enter or Space) opens it from the
 * keyboard and pins it. Below lg the header shows icons only and has room for one 44px target, so
 * the item is one button (grid icon and a small chevron) that opens the panel, whose first link is
 * /products. Without JavaScript (and in the server HTML, until hydration) that item is a plain
 * link to /products of the same size: no layout shift, and it works without JS.
 *
 * The panel spans the header row (it is placed against SiteHeader's row, like the offers menu),
 * scrolls when taller than the screen, and closes on Escape (focus back to the button), a click
 * outside, focus leaving the item, and any navigation.
 */
export function ProductsNav({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(navMenuReducer, NAV_MENU_CLOSED);
  const { open } = state;
  const mounted = useMounted();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const phoneButtonRef = useRef<HTMLButtonElement>(null);
  const wideButtonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  // Any navigation closes it (a link in the panel, back and forward): React's pattern for state
  // that follows a value, set while rendering rather than in an effect.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    dispatch("navigate");
  }

  useEffect(() => cancelClose, []);

  // Closes on a click outside and on Escape (focus goes back to the visible button).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) dispatch("outside");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dispatch("escape");
      const visible = [wideButtonRef.current, phoneButtonRef.current].find(
        (b) => b && b.getClientRects().length > 0,
      );
      visible?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    cancelClose();
    dispatch("toggle");
  };

  return (
    // Not positioned itself: the panel is placed against the header row (SiteHeader).
    <div
      ref={rootRef}
      className="flex items-center"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelClose();
        dispatch("hover-enter");
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelClose();
        closeTimer.current = setTimeout(() => dispatch("hover-leave"), HOVER_CLOSE_DELAY_MS);
      }}
      onBlur={(e) => {
        // Tabbing out of the item (or the open panel) closes it.
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          dispatch("focus-out");
        }
      }}
    >
      {/* Below lg: one 44px target. */}
      {mounted ? (
        <button
          ref={phoneButtonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={LABEL}
          onClick={toggle}
          className={`${navLink} gap-0.5 aria-expanded:bg-surface aria-expanded:text-ink lg:hidden`}
        >
          <LayoutGrid aria-hidden className="size-[18px]" />
          <ChevronDown
            aria-hidden
            className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : (
        <Link href={PRODUCTS_PATH} aria-label={LABEL} className={`${navLink} gap-0.5 lg:hidden`}>
          <LayoutGrid aria-hidden className="size-[18px]" />
          <ChevronDown aria-hidden className="size-3" />
        </Link>
      )}

      {/* From lg: the link and the chevron that opens the panel. */}
      <Link href={PRODUCTS_PATH} className={`${navLink} hidden ps-4 pe-1 lg:flex`}>
        <LayoutGrid aria-hidden className="size-[18px]" />
        {LABEL}
      </Link>
      <button
        ref={wideButtonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="הקטגוריות של כל המוצרים"
        onClick={toggle}
        className={`${navLink} hidden aria-expanded:bg-surface aria-expanded:text-ink lg:flex`}
      >
        <ChevronDown
          aria-hidden
          className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div
        id={panelId}
        hidden={!open}
        onClick={(e) => {
          if ((e.target as Element).closest("a")) dispatch("navigate");
        }}
        className="absolute inset-x-0 top-full z-40 px-2 pt-1 sm:px-4"
      >
        {children}
      </div>
    </div>
  );
}
