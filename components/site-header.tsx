import Link from "next/link";
import {
  CalendarClock,
  ChevronLeft,
  Heart,
  History,
  Search,
  Sparkles,
  Tag,
  TicketPercent,
} from "lucide-react";
import { BRAND } from "@/lib/config/brand";
import { CATALOG, categoryPath } from "@/lib/catalog/categories";
import { DEALS_ENABLED } from "@/lib/config/site";
import { PRODUCTS_PATH } from "@/lib/hot/params";
import { CatalogIcon } from "./catalog-icon";
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasPublishedDeals, hasUpcomingSales } from "@/lib/deals/queries";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { OffersNav, type OfferLink } from "./offers-nav";
import { ProductsNav } from "./products-nav";
import { SavedCount, SavedNavLink } from "./saved-list";
import { StickyHeader } from "./sticky-header";
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
    <StickyHeader>
      {/* Tight gaps and icon-only links on phones: logo, recent searches, all products, one offers
          icon (or the offers menu) and the theme toggle fit from 375px; at 320px without a
          horizontal scroll (the nav then takes most of the side padding). Relative: the offers
          menu and the categories panel open under this row. */}
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:h-20 sm:gap-3 sm:px-6">
        <Logo />
        {/* Below lg (owner request 2026-10-24): one menu button (components/mobile-menu.tsx) instead of a row
            of icons, the saved products in the bottom bar (components/bottom-nav.tsx); from lg the
            links show. */}
        <nav aria-label="ניווט ראשי" className="flex items-center gap-1 whitespace-nowrap sm:gap-2">
          <Link
            href="/"
            className="hidden min-h-11 items-center rounded-full px-4 font-medium text-muted hover:text-ink lg:flex"
          >
            חיפוש
          </Link>
          {/* An icon from lg, with its words from xl, where the row has room. */}
          <Link
            href="/searches"
            aria-label="חיפושים אחרונים"
            className="hidden min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full font-medium text-muted hover:text-ink lg:flex xl:px-4"
          >
            <History aria-hidden className="size-[18px]" />
            <span className="hidden xl:inline">חיפושים אחרונים</span>
          </Link>
          {/* "כל המוצרים" and its categories panel (owner request 2026-10-03), from lg. */}
          <div className="hidden lg:flex">
            <ProductsNav>
              <CategoriesPanel />
            </ProductsNav>
          </div>
          <div className="hidden lg:flex">
            <OffersNav links={offers} />
          </div>
          {/* "המוצרים ששמרתי" (owner request 2026-10-24): the heart and how many are saved. */}
          <div className="hidden lg:flex">
            <SavedNavLink />
          </div>
          <div className="hidden lg:flex">
            <ThemeToggle />
          </div>
          <MobileMenu brand={BRAND.name}>
            <MobileMenuContent offers={offers} />
          </MobileMenu>
        </nav>
      </div>
    </StickyHeader>
  );
}

const OFFER_ICONS = { deals: Tag, sales: CalendarClock, coupons: TicketPercent } as const;

/**
 * The phone menu's content (inside MobileMenu): search first, then the visitor's own places and the
 * offers, then every category with its icon, and the colour scheme at the bottom. Server-rendered;
 * links without prefetch where the page loads AliExpress data.
 */
function MobileMenuContent({ offers }: { offers: OfferLink[] }) {
  const row =
    "flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium text-ink hover:bg-surface-2";
  const icon = "size-5 shrink-0 text-muted";
  return (
    <div className="space-y-6 p-4">
      <Link
        href="/"
        className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 font-bold text-on-accent hover:bg-accent-ink"
      >
        <Search aria-hidden className="size-5" />
        חיפוש מוצרים
      </Link>

      <ul className="space-y-0.5">
        <li>
          <Link href="/saved" className={row}>
            <Heart aria-hidden className={icon} />
            <span className="flex-1">המוצרים ששמרתי</span>
            <SavedCount />
          </Link>
        </li>
        <li>
          <Link href="/searches" className={row}>
            <History aria-hidden className={icon} />
            חיפושים אחרונים
          </Link>
        </li>
        <li>
          <Link href="/recommended" className={row}>
            <Sparkles aria-hidden className={icon} />
            המומלצים שלנו
          </Link>
        </li>
        {offers.map((o) => {
          const Icon = OFFER_ICONS[o.key];
          return (
            <li key={o.key}>
              <Link href={o.href} className={row}>
                <Icon aria-hidden className={icon} />
                {o.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="menu-categories" className="space-y-2">
        <h2 id="menu-categories" className="px-3 text-sm font-semibold text-muted">
          קטגוריות
        </h2>
        <ul className="grid grid-cols-1 gap-0.5 min-[360px]:grid-cols-2">
          {CATALOG.map((c) => (
            <li key={c.key}>
              <Link
                href={categoryPath(c)}
                prefetch={false}
                className="flex min-h-12 items-center gap-2.5 rounded-xl px-3 text-[15px] text-ink hover:bg-surface-2"
              >
                <CatalogIcon name={c.icon} className="size-[18px] shrink-0 text-muted" />
                <span className="leading-tight">{c.nameHe}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={PRODUCTS_PATH}
          prefetch={false}
          className="flex min-h-12 items-center gap-1.5 rounded-xl px-3 font-semibold text-accent-ink hover:bg-surface-2"
        >
          לכל המוצרים
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-line px-3 pt-4">
        <span className="font-medium">מצב תצוגה</span>
        <ThemeToggle />
      </div>
    </div>
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
