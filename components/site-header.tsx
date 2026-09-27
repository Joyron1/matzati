import Link from "next/link";
import { History } from "lucide-react";
import { DEALS_ENABLED } from "@/lib/config/site";
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasPublishedDeals, hasUpcomingSales } from "@/lib/deals/queries";
import { Logo } from "./logo";
import { OffersNav, type OfferLink } from "./offers-nav";
import { ThemeToggle } from "./theme-toggle";

/** Deals, sales and coupons, each only while its page has something to show. */
async function offerLinks(): Promise<OfferLink[]> {
  // None of these throws: a failure reads as "nothing to show".
  const [deals, sales, coupons] = await Promise.all([
    DEALS_ENABLED && hasPublishedDeals(),
    hasUpcomingSales(),
    hasPublishedCoupons(),
  ]);
  const links: OfferLink[] = [];
  if (deals) links.push({ key: "deals", href: "/deals", label: "דילים" });
  if (sales) links.push({ key: "sales", href: "/sales", label: "מבצעים" });
  if (coupons) links.push({ key: "coupons", href: "/coupons", label: "קופונים" });
  return links;
}

export async function SiteHeader() {
  const offers = await offerLinks();
  return (
    <header className="border-b border-line bg-bg">
      {/* Tight gaps and icon-only links on phones: logo, recent searches, one offers icon (or the
          offers menu) and the theme toggle fit at 360px, and at 320px without a horizontal scroll
          (the nav then takes most of the side padding). Relative: the offers menu opens under
          this row. */}
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:h-20 sm:gap-3 sm:px-6">
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
          <OffersNav links={offers} />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
