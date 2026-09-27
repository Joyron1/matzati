import Link from "next/link";
import { ChevronLeft, Clock, Search, Tag } from "lucide-react";
import { formatHourAgo } from "@/lib/format";
import type { RecentSearch } from "@/lib/recent/types";
import { searchHref } from "@/lib/search-url";
import type { FilterChip } from "@/lib/types";
import { ProductImage } from "./product-image";
import { card } from "./styles";

const PHOTO_SLOTS = 3;

// Same colors as the "הבנתי ככה" chips, smaller because nothing here is clickable.
const CHIP = "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold";
const chipColors = (chip: FilterChip) =>
  chip.kind === "keywords"
    ? "bg-accent-soft text-accent-ink"
    : "border border-line bg-surface text-ink";

/** A search whose photos we cannot show (none, or none from an allowed host). */
function NoPhoto({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={`grid place-items-center rounded-tile bg-accent-soft text-accent-ink ${className}`}
    >
      <Search className="size-7" strokeWidth={1.5} />
    </div>
  );
}

interface RecentSearchCardProps {
  search: RecentSearch;
  /** Time of the render, for "לפני 5 דקות". Server-only: the text is never hydrated. */
  now: Date;
}

/**
 * One listed search on /searches. The whole card is a single link to the search's results (the
 * "לתוצאות" link is stretched over the card), so there is nothing else interactive inside it.
 * (The home page shows recent searches as product pills: components/recent-searches-strip.tsx.)
 */
export function RecentSearchCard({ search, now }: RecentSearchCardProps) {
  const title = (
    <h2 className="line-clamp-2 text-lg leading-snug font-bold">
      ״<bdi>{search.query}</bdi>״
    </h2>
  );
  const footer = (
    <div className="mt-auto flex items-end justify-between gap-3 text-sm">
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted">
        <span className="inline-flex items-center gap-1">
          <Clock aria-hidden className="size-3.5 shrink-0" />
          {/* searchedAt is rounded down to the hour, so the text never claims minutes. */}
          <time dateTime={search.searchedAt}>{formatHourAgo(search.searchedAt, now)}</time>
        </span>
        {search.categoryHe && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Tag aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{search.categoryHe}</span>
          </span>
        )}
      </p>
      <Link
        // from=recent: the visitor did not type it, so this run is never listed again (it would
        // put the card back on top with every click).
        href={searchHref({ q: search.query, from: "recent" })}
        // Crawlers may follow this page, and an expired search costs a new run; the target is
        // noindex anyway. No prefetch: a page of cards would fire a request per card.
        rel="nofollow"
        prefetch={false}
        className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-accent-ink after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
      >
        לתוצאות
        <span className="sr-only"> של החיפוש ״{search.query}״</span>
        <ChevronLeft aria-hidden className="size-4" />
      </Link>
    </div>
  );

  const photos = search.images.slice(0, PHOTO_SLOTS);
  return (
    <article className={`${card} relative flex h-full flex-col gap-4 p-4 hover:border-accent`}>
      {title}
      {/* Shown above the title, but read after it: the query is what the card is about. Fewer
          than 3 photos leave the rest of the row empty, so every title starts at the same height. */}
      <div className="order-first grid grid-cols-3 gap-2">
        {photos.length > 0 ? (
          photos.map((photo, i) => (
            <ProductImage
              key={i}
              src={photo.src}
              alt={photo.alt}
              className="aspect-square w-full rounded-tile"
              iconClassName="size-8"
              sizes="120px"
            />
          ))
        ) : (
          <NoPhoto className="aspect-square w-full" />
        )}
      </div>
      {search.chips.length > 0 && (
        <ul aria-label="מה הבנו מהחיפוש" className="flex flex-wrap gap-1.5">
          {search.chips.map((chip) => (
            <li key={chip.id} className={`${CHIP} ${chipColors(chip)}`}>
              {chip.label_he}
            </li>
          ))}
        </ul>
      )}
      {footer}
    </article>
  );
}
