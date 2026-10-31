"use client";

// The phone's bottom bar (design 9, owner's choice 2026-10-24): four thumb-reachable tabs below lg,
// the active one red. "חיפוש" on the home page moves focus into the composer; elsewhere it goes
// home, where the composer is the first thing. A spacer in the flow keeps the footer's end clear.
import { Heart, Home, LayoutGrid, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSavedList } from "./save-button";
// The composer field's id (COMPOSER_INPUT_ID in search-composer.tsx; not imported, so other pages
// do not load the composer's module).
const COMPOSER_INPUT_ID = "composer-q";

// /telegram is a campaign page with its own join bar fixed to the bottom.
const HIDDEN_ON = /^\/(admin|dev|telegram)(\/|$)/;

const TABS = [
  { href: "/", label: "בית", icon: Home, match: (p: string) => p === "/" },
  { href: "/", label: "חיפוש", icon: Search, match: (p: string) => p.startsWith("/search") },
  {
    href: "/products",
    label: "כל המוצרים",
    icon: LayoutGrid,
    match: (p: string) => p.startsWith("/products"),
  },
  { href: "/saved", label: "שמורים", icon: Heart, match: (p: string) => p === "/saved" },
] as const;

function focusComposer(event: React.MouseEvent) {
  const field = document.getElementById(COMPOSER_INPUT_ID);
  if (!field) return;
  event.preventDefault();
  field.scrollIntoView({ block: "center" });
  field.focus({ preventScroll: true });
}

export function BottomNav() {
  const pathname = usePathname();
  const count = useSavedList().length;
  if (HIDDEN_ON.test(pathname)) return null;
  return (
    <>
      <div
        aria-hidden
        className="h-[calc(4rem+env(safe-area-inset-bottom))] lg:hidden print:hidden"
      />
      <nav
        aria-label="ניווט מהיר"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.04)] lg:hidden print:hidden"
      >
        <ul className="grid h-16 grid-cols-4">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            const Icon = tab.icon;
            const isSearch = tab.label === "חיפוש";
            return (
              <li key={tab.label}>
                <Link
                  href={tab.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  onClick={isSearch && pathname === "/" ? focusComposer : undefined}
                  className={`relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                    active ? "text-accent" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden className="size-[22px]" strokeWidth={active ? 2.4 : 2} />
                  {tab.label}
                  {tab.href === "/saved" && count > 0 && (
                    <span
                      aria-hidden
                      className="absolute top-1.5 start-[calc(50%+4px)] grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] leading-[18px] font-bold text-on-accent"
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                  {tab.href === "/saved" && count > 0 && (
                    <span className="sr-only"> ({count})</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
