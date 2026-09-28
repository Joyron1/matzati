// Class strings the home hot products carousel (hot-products-scroller.tsx, a client component)
// shares with its placeholder (hot-products-carousel.tsx), so the placeholder takes the carousel's
// room. A plain module: a server component cannot read constants from a "use client" file.

/** The carousel: its width, gutters and the gap to the notes under the row. */
export const HOT_SECTION = "mx-auto max-w-6xl space-y-2 px-4 sm:px-6";
/** The heading beside, from sm, the previous and next buttons. */
export const HOT_HEADER_ROW = "flex items-end justify-between gap-4";
export const HOT_NAV_BUTTONS = "hidden shrink-0 gap-2 sm:flex";
/**
 * The row of cards. It bleeds to the screen edges on phones; the padding keeps the cards' focus
 * rings inside the scroll area, and scroll-px lines a snapped card up with the page's side padding.
 */
export const HOT_ROW =
  "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 py-2 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin] sm:-mx-2 sm:scroll-px-2 sm:gap-4 sm:px-2";
/**
 * One card. On phones about 2.3 cards fit the screen, so the third one shows at least 30px from
 * 360px up and the row reads as one to swipe (with 2 whole cards it looked static). Below 360px
 * two narrower cards would fit whole, so there one wider card shows with most of a second.
 */
export const HOT_ITEM =
  "w-[calc((100vw-3.5rem)/2.3)] min-w-36 shrink-0 snap-start max-[359px]:w-44 sm:w-48 lg:w-52";
/** next/image sizes for a card's photo. */
export const HOT_ITEM_SIZES = "(min-width: 1024px) 208px, (min-width: 640px) 192px, 40vw";
