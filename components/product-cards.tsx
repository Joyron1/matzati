import Link from "next/link";
import { Trophy } from "lucide-react";
import type { LoggedResult } from "@/lib/search-url";
import { BuyButton } from "./buy-button";
import { TitleText } from "./card-lines";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import {
  aboveCardLink,
  btnLg,
  btnMd,
  btnSecondary,
  btnSm,
  card,
  cardLink,
  featured,
  linkCard,
} from "./styles";
import { TrustMetrics } from "./trust-metrics";

interface CardProps {
  /** A result; search_uid (when the search was logged for this visitor) goes to /go with rank. */
  product: LoggedResult;
  rank: number;
  /** Query that produced this result, so the product page can link back. */
  q: string;
}

/**
 * The visible button to the product page (owner decision 2026-10-03, was "לפרטים"). The whole card
 * links there too: its title link covers the card (linkCard), and only the buy button and its note
 * stand above that cover.
 */
export const DETAILS_LABEL = "למידע נוסף";

function productHref(id: string, q: string) {
  const path = `/p/${encodeURIComponent(id)}`;
  return q ? `${path}?q=${encodeURIComponent(q)}` : path;
}

/**
 * The first result. A container: in a column (beside the compact cards) the photo stands above the
 * text; given the page's full width (more compact cards under it) the photo stands beside it.
 */
export function FeaturedProductCard({ product, rank, q }: CardProps) {
  const href = productHref(product.product_id, q);
  return (
    <article className={`${featured} ${linkCard} @container p-4 sm:p-6`}>
      <div className="flex flex-col gap-5 @2xl:grid @2xl:grid-cols-2 @2xl:items-start @2xl:gap-6">
        <div className="relative">
          <ProductImage
            src={product.image_urls[0]}
            alt={product.title_he}
            className="aspect-[4/3] w-full rounded-card"
            iconClassName="size-24"
            sizes="(min-width: 1024px) 560px, 92vw"
            preload
          />
          <span className="absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1.5 text-sm font-bold text-on-gold">
            <Trophy aria-hidden className="size-4" />
            מקום {rank} בדירוג
          </span>
        </div>

        {/* A container too: its buttons stand side by side when they fit. */}
        <div className="@container flex flex-col gap-5">
          <div className="space-y-3">
            <h2 className="text-xl leading-snug font-bold sm:text-2xl">
              <Link
                href={href}
                data-card-link
                className={`block hover:text-accent-ink ${cardLink}`}
              >
                <TitleText title={product.title_he} />
              </Link>
            </h2>
            {product.why_he && (
              <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-accent-ink">
                <span className="font-bold">למה בחרנו: </span>
                {product.why_he}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <Price product={product} size="lg" />
            <TrustMetrics product={product} />
          </div>

          <div className="grid gap-3 @sm:grid-cols-[1fr_auto] @sm:items-start">
            <BuyButton
              productId={product.product_id}
              src="search_featured"
              searchUid={product.search_uid}
              position={rank}
              raised
            />
            <Link href={href} className={`${btnSecondary} ${btnLg} ${aboveCardLink}`}>
              {DETAILS_LABEL}
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * A result card with its photo beside the title. `tile` (the SEO landing pages' grid): from xl it
 * stands as a tile of a five-column grid, the photo above the text, with the title's two lines,
 * the numbers' two lines and the line's four kept even when shorter, so every tile of a row lines
 * up; below xl it is the same row card as on /search.
 */
export function CompactProductCard({
  product,
  rank,
  q,
  src = "search_compact",
  tile = false,
}: CardProps & { src?: string; tile?: boolean }) {
  const href = productHref(product.product_id, q);
  return (
    // A container: in a narrow column (two compact cards side by side) its buttons stack.
    <article
      className={`${card} ${linkCard} @container flex flex-col gap-4 p-4 ${tile ? "xl:gap-3 xl:p-3" : ""}`}
    >
      <div className={`flex gap-4 ${tile ? "xl:flex-col xl:gap-3" : ""}`}>
        <ProductImage
          src={product.image_urls[0]}
          alt={product.title_he}
          className={`size-24 shrink-0 rounded-tile sm:size-28 ${tile ? "xl:aspect-[4/3] xl:h-auto xl:w-full" : ""}`}
          iconClassName="size-10"
          sizes={tile ? "(min-width: 1280px) 240px, 112px" : "112px"}
        />
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold text-muted">מקום {rank} בדירוג</p>
          <h3 className={`leading-snug font-semibold ${tile ? "xl:min-h-[2lh]" : ""}`}>
            <Link href={href} data-card-link className={`block hover:text-accent-ink ${cardLink}`}>
              <TitleText title={product.title_he} clamp />
            </Link>
          </h3>
          <Price product={product} size="sm" />
        </div>
      </div>
      <div className={tile ? "xl:min-h-[3.25rem]" : "contents"}>
        <TrustMetrics product={product} short />
      </div>
      {product.why_he && (
        <p className={`text-sm leading-relaxed text-muted ${tile ? "xl:min-h-[4lh]" : ""}`}>
          {product.why_he}
        </p>
      )}
      <div className="mt-auto grid gap-2 @[19rem]:grid-cols-[1fr_auto] @[19rem]:items-start">
        <BuyButton
          productId={product.product_id}
          src={src}
          searchUid={product.search_uid}
          position={rank}
          size="md"
          raised
        />
        <Link href={href} className={`${btnSecondary} ${btnMd} ${aboveCardLink}`}>
          {DETAILS_LABEL}
        </Link>
      </div>
    </article>
  );
}

/**
 * Places 6-10 of the first view (RESULTS_FIRST_VIEW): a standard card, the site's card language
 * (HotProductCard's photo on top) with a result's parts: our Hebrew title (the titles call, or
 * AliExpress's title when it failed), the price, the trust numbers with the shared-numbers note, the
 * buy button with its "קישור שותפים" note, and "למידע נוסף" (the whole card opens the product page
 * too). No "why we picked it" line. Narrow enough
 * for two in a row on a phone: the buttons take the full width and their labels may wrap. No
 * prefetch: a product page older than a day refreshes from AliExpress, and a row of cards would do
 * that for every card on screen.
 */
export function StandardProductCard({ product, rank, q }: CardProps) {
  const href = productHref(product.product_id, q);
  return (
    <article className={`${card} ${linkCard} flex h-full flex-col overflow-hidden`}>
      <ProductImage
        src={product.image_urls[0]}
        // The title below names the product; the photo only helps scanning.
        alt=""
        className="aspect-square w-full border-b border-line"
        iconClassName="size-10"
        sizes="(min-width: 1280px) 220px, (min-width: 768px) 30vw, 46vw"
      />
      <div className="flex flex-1 flex-col gap-2.5 p-3 sm:p-4">
        <p className="text-xs font-semibold text-muted">מקום {rank} בדירוג</p>
        <h3 className="text-[15px] leading-snug font-semibold">
          <Link
            href={href}
            prefetch={false}
            data-card-link
            className={`block hover:text-accent-ink ${cardLink}`}
          >
            <TitleText title={product.title_he} clamp />
          </Link>
        </h3>
        <Price product={product} size="sm" />
        <TrustMetrics product={product} short />
        <div className="mt-auto grid gap-1 pt-1">
          <BuyButton
            productId={product.product_id}
            src="search_extra"
            searchUid={product.search_uid}
            position={rank}
            size="sm"
            raised
          />
          <Link
            href={href}
            prefetch={false}
            className={`${btnSecondary} ${btnSm} w-full ${aboveCardLink}`}
          >
            {DETAILS_LABEL}
          </Link>
        </div>
      </div>
    </article>
  );
}
