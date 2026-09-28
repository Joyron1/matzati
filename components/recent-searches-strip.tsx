import Link from "next/link";
import { connection } from "next/server";
import { ChevronLeft, History, Search } from "lucide-react";
import { isAllowedImage } from "@/lib/images";
import { productLabelOf, uniqueByProduct } from "@/lib/recent/display";
import { latestRecentSearches } from "@/lib/recent/queries";
import { RECENT_PAGE_SIZE, type RecentSearch } from "@/lib/recent/types";
import { searchHref } from "@/lib/search-url";
import { ProductImage } from "./product-image";
import { card } from "./styles";

/** Whole rows at every width: 2 per row on phones, 3 from sm, 6 from lg. */
const STRIP_SIZE = 6;
/**
 * Rows of tiles of a fixed width (a grid's column: 2, 3 or 6 to a row), centered as a group, so
 * fewer searches than a full row (production had 2) sit in the middle under the centered title
 * instead of leaving a gap beside them. Tiles in a row stretch to the tallest.
 */
const ROW = "flex flex-wrap justify-center gap-3 sm:gap-4";
const CELL =
  "min-w-0 w-[calc((100%-0.75rem)/2)] sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-5rem)/6)]";
// Shared with the placeholder, so both are the same height: the tile frame, the square photo, two
// lines of label (a one-line label keeps the room, so every "לתוצאות" sits on the same line) and
// the "לתוצאות" line.
const TILE = `${card} flex h-full flex-col gap-2 p-2 pb-3`;
const PHOTO = "aspect-square w-full rounded-tile";
const LABEL = "line-clamp-2 min-h-[2lh] px-1 leading-snug font-semibold";
const MORE = "mt-auto inline-flex h-5 items-center gap-0.5 px-1 text-sm font-semibold";

const ALL_LINK =
  "inline-flex min-h-11 items-center gap-0.5 text-sm font-semibold text-accent-ink underline-offset-4 hover:underline";

/**
 * The title row: the heading and, on the same line, the link to every recent search. `ghost` is
 * the placeholder's copy: the same size (it wraps at 320px too), but no heading and no link.
 */
function Title({ ghost = false }: { ghost?: boolean }) {
  const Heading = ghost ? "p" : "h2";
  const allLabel = (
    <>
      לכל החיפושים האחרונים
      <ChevronLeft aria-hidden className="size-4" />
    </>
  );
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-center gap-x-4">
      {/* "חיפושים אחרונים" like the header, the footer and /searches: "חיפושים חמים" was easy to
          confuse with "מוצרים חמים" right under it. */}
      <Heading
        id={ghost ? undefined : "recent-searches-title"}
        className="inline-flex items-center gap-2 font-display text-2xl text-ink"
      >
        <History aria-hidden className="size-6 shrink-0 text-accent-ink" />
        חיפושים אחרונים
      </Heading>
      {ghost ? (
        <span className={ALL_LINK}>{allLabel}</span>
      ) : (
        <Link href="/searches" className={ALL_LINK}>
          {allLabel}
        </Link>
      )}
    </div>
  );
}

/**
 * One search as a tile: its first result photo and the product label. The whole tile is the
 * link; it lifts and its border turns cobalt on hover and on keyboard focus (the site focus ring
 * goes around it).
 */
function Tile({ search }: { search: RecentSearch }) {
  // The first photo we can show (next/image accepts AliExpress hosts only).
  const photo = search.images.find((image) => isAllowedImage(image.src));
  return (
    <Link
      // from=recent: the visitor did not type it, so this run is never listed again (it would put
      // the tile back on top with every click).
      href={searchHref({ q: search.query, from: "recent" })}
      // Crawlers may follow this page, and an expired search costs a new run; the target is
      // noindex anyway. No prefetch: a grid of tiles would fire a request per tile.
      rel="nofollow"
      prefetch={false}
      className={`group ${TILE} transition duration-200 hover:border-accent focus-visible:border-accent motion-safe:hover:-translate-y-1 motion-safe:focus-visible:-translate-y-1`}
    >
      {photo ? (
        // The label names the product; the photo only helps scanning.
        <ProductImage
          src={photo.src}
          alt=""
          // The edge keeps a white product photo from glaring inside a dark tile.
          className={`${PHOTO} ring-1 ring-line`}
          iconClassName="size-10"
          sizes="(min-width: 1024px) 180px, (min-width: 640px) 30vw, 45vw"
        />
      ) : (
        <span
          aria-hidden
          className={`grid place-items-center bg-accent-soft text-accent-ink ${PHOTO}`}
        >
          <Search className="size-10" strokeWidth={1.5} />
        </span>
      )}
      <span className={`${LABEL} text-ink group-hover:text-accent-ink`}>
        {productLabelOf(search)}
      </span>
      <span className={`${MORE} text-accent-ink`}>
        לתוצאות
        <ChevronLeft
          aria-hidden
          className="size-4 transition-transform duration-200 motion-safe:group-hover:-translate-x-0.5 motion-safe:group-focus-visible:-translate-x-0.5"
        />
      </span>
    </Link>
  );
}

/**
 * Home page "חיפושים אחרונים", right under the search composer: one tile per product of the newest
 * listed searches; hidden when there are none. The home page is indexed, so a tile shows the
 * product we understood, never the visitor's own words (owner decision 2026-09-27; /searches
 * shows the queries, noindex). Big photo tiles, so they read as something to tap (owner request
 * 2026-09-28; they were small pills).
 */
export async function RecentSearchesStrip() {
  await connection(); // recent = as of this visit, not of the build
  // A full page, so products searched twice ("בובת סוניק", "בובת סוניק לילד") still fill the grid.
  const searches = uniqueByProduct(await latestRecentSearches(RECENT_PAGE_SIZE), STRIP_SIZE);
  return <RecentSearchesTiles searches={searches} />;
}

/** The strip for these searches (up to STRIP_SIZE); nothing without any. The dev preview too. */
export function RecentSearchesTiles({ searches }: { searches: RecentSearch[] }) {
  if (searches.length === 0) return null;
  return (
    <section aria-labelledby="recent-searches-title" className="space-y-3">
      <Title />
      <ul className={ROW}>
        {searches.slice(0, STRIP_SIZE).map((search) => (
          <li key={search.queryNorm} className={CELL}>
            <Tile search={search} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The strip's exact height (a full grid), so what is under it does not jump when it streams in.
 * The title row is invisible: the strip renders nothing when there are no searches to show, and
 * a title must not flash.
 */
export function RecentSearchesStripPlaceholder() {
  return (
    <div aria-hidden className="space-y-3">
      <div className="invisible">
        <Title ghost />
      </div>
      <div className={ROW}>
        {Array.from({ length: STRIP_SIZE }, (_, i) => (
          <div key={i} className={`${CELL} ${TILE}`}>
            <div className={`${PHOTO} animate-pulse bg-surface-2`} />
            <div className={LABEL}>
              <div className="mt-1 h-4 w-3/4 animate-pulse rounded-full bg-surface-2" />
            </div>
            <div className={MORE}>
              <div className="h-3 w-14 animate-pulse rounded-full bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
