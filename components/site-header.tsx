import Link from "next/link";
import { ChevronLeft, History } from "lucide-react";
import { CATALOG, categoryPath } from "@/lib/catalog/categories";
import { DEALS_ENABLED } from "@/lib/config/site";
import { PRODUCTS_PATH } from "@/lib/hot/params";
import { CatalogIcon } from "./catalog-icon";
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasPublishedDeals, hasUpcomingSales } from "@/lib/deals/queries";
import { Logo } from "./logo";
import { OffersNav, type OfferLink } from "./offers-nav";
import { ProductsNav } from "./products-nav";
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
      {/* Tight gaps and icon-only links on phones: logo, recent searches, all products, one offers
          icon (or the offers menu) and the theme toggle fit from 375px; at 320px without a
          horizontal scroll (the nav then takes most of the side padding). Relative: the offers
          menu and the categories panel open under this row. */}
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:h-20 sm:gap-3 sm:px-6">
        <Logo />
        {/* No gaps under 390px: the 44px targets (icons centered in them) keep their room. */}
        <nav
          aria-label="ניווט ראשי"
          className="flex items-center gap-0 min-[390px]:gap-0.5 sm:gap-2"
        >
          {/* From lg only: below it the logo links home, and the row needs the room. */}
          <Link
            href="/"
            className="hidden min-h-11 items-center rounded-full px-4 font-medium text-muted hover:text-ink lg:flex"
          >
            חיפוש
          </Link>
          {/* Icon only on phones, to keep the header uncluttered. With an offers icon as well,
              five items do not fit under 375px, so there it gives way to all products (the
              home page's recent searches and the footer link to /searches too). */}
          <Link
            href="/searches"
            aria-label="חיפושים אחרונים"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full font-medium text-muted hover:text-ink sm:px-4 ${
              offers.length ? "max-[374px]:hidden" : ""
            }`}
          >
            <History aria-hidden className="size-[18px]" />
            <span className="hidden sm:inline">חיפושים אחרונים</span>
          </Link>
          {/* "כל המוצרים" and its categories (owner request 2026-10-03): an icon button below lg,
              the link and a chevron from lg (components/products-nav.tsx). */}
          <ProductsNav>
            <CategoriesPanel />
          </ProductsNav>
          <OffersNav links={offers} />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

/**
 * The categories panel of the header's "כל המוצרים" (ProductsNav shows and hides it). Rendered here,
 * on the server, with the icons. One column on phones, scrolling when taller than the screen; a
 * grid from sm. Links without prefetch: a category page loads its AliExpress list when opened.
 */
function CategoriesPanel() {
  const item =
    "flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium text-ink hover:bg-surface-2";
  return (
    <div className="mx-auto max-h-[calc(100dvh-5.5rem)] max-w-6xl overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-2 shadow-soft sm:p-3">
      <ul className="grid grid-cols-1 gap-x-2 gap-y-0.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {CATALOG.map((c) => (
          <li key={c.key}>
            <Link href={categoryPath(c)} prefetch={false} className={item}>
              <CatalogIcon name={c.icon} className="size-[18px] shrink-0 text-muted" />
              {c.nameHe}
            </Link>
          </li>
        ))}
      </ul>
      <hr className="mx-3 mt-1 border-line" />
      <Link
        href={PRODUCTS_PATH}
        prefetch={false}
        className="mt-1 flex min-h-12 items-center gap-1.5 rounded-xl px-3 font-semibold text-accent-ink hover:bg-surface-2"
      >
        לכל המוצרים
        <ChevronLeft aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
