import Link from "next/link";
import { Flame, History } from "lucide-react";
import { DEALS_ENABLED } from "@/lib/config/site";
import { hasPublishedDeals } from "@/lib/deals/queries";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export async function SiteHeader() {
  const showDeals = DEALS_ENABLED && (await hasPublishedDeals());
  return (
    <header className="border-b border-line bg-bg">
      {/* Tight gaps and icon-only links on phones: logo, recent searches, deals and the theme
          toggle fit at 360px, and at 320px without a horizontal scroll (the nav then takes most
          of the side padding). */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:h-20 sm:gap-3 sm:px-6">
        <Logo />
        <nav aria-label="ניווט ראשי" className="flex items-center gap-0.5 sm:gap-2">
          <Link
            href="/"
            className="hidden min-h-11 items-center rounded-full px-4 font-medium text-muted hover:text-ink sm:flex"
          >
            חיפוש
          </Link>
          {/* Icon only on phones, to keep the header uncluttered. */}
          <Link
            href="/searches"
            aria-label="חיפושים אחרונים"
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full font-medium text-muted hover:text-ink sm:px-4"
          >
            <History aria-hidden className="size-[18px]" />
            <span className="hidden sm:inline">חיפושים אחרונים</span>
          </Link>
          {showDeals && (
            // Icon only on phones too: with both links spelled out the header overflows at 320px.
            <Link
              href="/deals"
              aria-label="דילים"
              className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full font-medium text-muted hover:text-ink sm:px-4"
            >
              <Flame aria-hidden className="size-[18px]" />
              <span className="hidden sm:inline">דילים</span>
            </Link>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
