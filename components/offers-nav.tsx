"use client";

import Link from "next/link";
import { BadgePercent, CalendarClock, Tag, TicketPercent } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

// Not Flame for deals: the header's Flame is "מוצרים חמים".
const ICONS = { deals: Tag, sales: CalendarClock, coupons: TicketPercent } as const;

export interface OfferLink {
  key: keyof typeof ICONS;
  href: string;
  label: string;
}

const navLink =
  "flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full font-medium text-muted hover:text-ink";

/** "דילים, מבצעים וקופונים" */
function listLabel(labels: string[]): string {
  return labels.length < 2
    ? labels.join("")
    : `${labels.slice(0, -1).join(", ")} ו${labels[labels.length - 1]}`;
}

/**
 * The header's deals, sales and coupons links (only those with content). One link shows as an
 * icon on phones and with its label from sm, as before. Several links would overflow the header
 * on phones (logo, hot products and the theme toggle leave room for one 44px icon at 320px),
 * so below lg they sit behind one button that opens a list; from lg they are spelled out.
 */
export function OffersNav({ links }: { links: OfferLink[] }) {
  if (links.length === 0) return null;
  if (links.length === 1) {
    const [{ key, href, label }] = links;
    const Icon = ICONS[key];
    return (
      <Link href={href} aria-label={label} className={`${navLink} sm:px-4`}>
        <Icon aria-hidden className="size-[18px]" />
        <span className="hidden sm:inline">{label}</span>
      </Link>
    );
  }
  return (
    <>
      <OffersMenu links={links} />
      {links.map(({ key, href, label }) => {
        const Icon = ICONS[key];
        return (
          <Link key={href} href={href} className={`${navLink} hidden px-4 lg:flex`}>
            <Icon aria-hidden className="size-[18px]" />
            {label}
          </Link>
        );
      })}
    </>
  );
}

/** Below lg: a disclosure button with the links in a panel under the header. */
function OffersMenu({ links }: { links: OfferLink[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Closes on a tap outside and on Escape (focus goes back to the button).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    // Not positioned itself: the panel is placed against the header row (SiteHeader), so it spans
    // the screen width on phones instead of hanging off the button.
    <div
      ref={rootRef}
      className="lg:hidden"
      onBlur={(e) => {
        // Tabbing out of the open list closes it.
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={listLabel(links.map((l) => l.label))}
        onClick={() => setOpen((o) => !o)}
        className={`${navLink} aria-expanded:bg-surface aria-expanded:text-ink`}
      >
        <BadgePercent aria-hidden className="size-[18px]" />
      </button>
      <ul
        id={panelId}
        hidden={!open}
        className="absolute inset-x-4 top-full z-40 mt-2 space-y-1 rounded-2xl border border-line bg-surface p-2 shadow-soft sm:inset-x-auto sm:end-6 sm:w-64"
      >
        {links.map(({ key, href, label }) => {
          const Icon = ICONS[key];
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium text-ink hover:bg-surface-2"
              >
                <Icon aria-hidden className="size-[18px] text-muted" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
