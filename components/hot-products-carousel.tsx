import Link from "next/link";
import { after } from "next/server";
import { shortLived } from "@/lib/cache-lifetime";
import { ChevronLeft, Flame } from "lucide-react";
import type { ReactNode } from "react";
import { HOT_FILTER_NOTE, HOT_TITLES_NOTE } from "@/lib/hot/copy";
import { PRODUCTS_PATH } from "@/lib/hot/params";
import { hotCarouselProducts, warmCarouselLists } from "@/lib/hot/queries";
import {
  HOT_HEADER_ROW,
  HOT_ITEM,
  HOT_ITEM_SIZES,
  HOT_NAV_BUTTONS,
  HOT_ROW,
  HOT_SECTION,
} from "./hot-carousel-layout";
import { HotProductCard, HotProductCardPlaceholder } from "./hot-product-card";
import { HotProductsScroller } from "./hot-products-scroller";

const TITLE = "מוצרים חמים";
/** Cards on a phone's first screen (about 2.3 are visible). */
const PRELOADED_CARDS = 2;
const LINK =
  "inline-flex min-h-11 shrink-0 items-center gap-0.5 font-semibold text-accent-ink underline-offset-4 hover:underline";

/** The heading and its line. `ghost` is the placeholder's copy: the same size, no heading. */
function Heading({ ghost = false }: { ghost?: boolean }) {
  const Title = ghost ? "p" : "h2";
  return (
    <div className="space-y-1">
      <Title
        id={ghost ? undefined : "hot-products-title"}
        className="flex items-center gap-2 font-display text-3xl text-ink"
      >
        <Flame aria-hidden className="size-7 shrink-0 text-accent-ink" />
        {TITLE}
      </Title>
      <p className="text-muted">הנמכרים באלי אקספרס, אחרי הסינון שלנו</p>
    </div>
  );
}

function NoteLink({
  ghost,
  href,
  children,
}: {
  ghost: boolean;
  href: string;
  children: ReactNode;
}) {
  return ghost ? (
    <span className={LINK}>{children}</span>
  ) : (
    <Link href={href} className={LINK}>
      {children}
    </Link>
  );
}

/**
 * Where the list comes from, what passed and how titles are made, with the links to /products and to
 * its "מאיפה הרשימה" (the source list is AliExpress's affiliate hot list: the commission it may
 * pay changes neither our filter nor the order). `ghost`: the same size, no links.
 */
function Notes({ ghost = false }: { ghost?: boolean }) {
  return (
    <div className="flex flex-col gap-x-6 gap-y-1 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm leading-relaxed text-muted">
        מתוך רשימת המוצרים החמים שאלי אקספרס מציעה לשותפים. {HOT_FILTER_NOTE} {HOT_TITLES_NOTE}
      </p>
      <div className="flex shrink-0 flex-wrap gap-x-5">
        <NoteLink ghost={ghost} href={`${PRODUCTS_PATH}#hot-about-title`}>
          מאיפה הרשימה
        </NoteLink>
        <NoteLink ghost={ghost} href={PRODUCTS_PATH}>
          לכל המוצרים
          <ChevronLeft aria-hidden className="size-4" />
        </NoteLink>
      </div>
    </div>
  );
}

/**
 * Home page "מוצרים חמים": up to 50 products picked at random at each render (every 10 minutes) from AliExpress's hot
 * lists of a few categories, each passed our filters, in one swipeable row (lib/hot,
 * hotCarouselProducts). Renders nothing when there is nothing to show, so it never leaves an empty
 * heading. Brings its own width and gutters; the page sets the gap above it.
 */
export async function HotProductsCarousel() {
  // The home page is cached 10 minutes (owner request 2026-10-08, Vercel CPU): the random pick is
  // made per render, so a new one every 10 minutes, and any copy of the HTML is a valid page. A
  // build reads the lists from the cache only (lib/hot/queries.ts, `building`).
  const products = await hotCarouselProducts();
  // The other hot categories' lists join the pick once this instance holds them; they are loaded
  // after the response, so no visitor waits for them (warmCarouselLists).
  after(() => warmCarouselLists());
  // The home page is cached 10 minutes: without the carousel (a cold cache at a build, AliExpress
  // down) it renders again after a minute.
  if (products.length === 0) {
    await shortLived();
    return null;
  }
  const now = new Date();
  return (
    <section aria-labelledby="hot-products-title" className={HOT_SECTION}>
      <HotProductsScroller label={TITLE} heading={<Heading />}>
        {products.map((product, i) => (
          <li key={product.productId} className={HOT_ITEM}>
            {/* The first photos are the largest paint on phones (Lighthouse 2026-09-30): fetched
                at high priority, not lazily; the rest wait until scrolled to. */}
            <HotProductCard
              product={product}
              now={now}
              sizes={HOT_ITEM_SIZES}
              preload={i < PRELOADED_CARDS}
            />
          </li>
        ))}
      </HotProductsScroller>
      <Notes />
    </section>
  );
}

/**
 * The carousel's size while it streams in (after a deploy a cold mix takes a few seconds), built
 * from the same pieces so what is under it does not jump: an invisible heading row and notes, and
 * a row of card shapes. No visible title: the carousel renders nothing when there is nothing to
 * show, and a title must not flash.
 */
export function HotProductsCarouselPlaceholder() {
  return (
    <div aria-hidden className={HOT_SECTION}>
      <div className="space-y-3">
        <div className={`${HOT_HEADER_ROW} invisible`}>
          <div className="min-w-0">
            <Heading ghost />
          </div>
          <div className={HOT_NAV_BUTTONS}>
            <span className="size-11 motion-reduce:hidden" />
            <span className="size-11 max-sm:hidden" />
            <span className="size-11 max-sm:hidden" />
          </div>
        </div>
        {/* tabIndex -1: an overflowing row with nothing focusable in it would take a Tab stop. */}
        <ul tabIndex={-1} className={HOT_ROW}>
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className={HOT_ITEM}>
              <HotProductCardPlaceholder />
            </li>
          ))}
        </ul>
      </div>
      <div className="invisible">
        <Notes ghost />
      </div>
    </div>
  );
}
