import Link from "next/link";
import { Flame } from "lucide-react";
import { DEALS_ENABLED } from "@/lib/config/site";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:h-20 sm:px-6">
        <Logo />
        <nav aria-label="ניווט ראשי" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="hidden min-h-11 items-center rounded-full px-4 font-medium text-muted hover:text-ink sm:flex"
          >
            חיפוש
          </Link>
          {DEALS_ENABLED && (
            <Link
              href="/deals"
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3 font-medium text-muted hover:text-ink sm:px-4"
            >
              <Flame aria-hidden className="size-[18px]" />
              דילים
            </Link>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
