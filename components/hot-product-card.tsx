import Link from "next/link";
import { Clapperboard, TicketPercent } from "lucide-react";
import { hasCurrentCode, type HotProduct } from "@/lib/hot/select";
import { hotTitle } from "@/lib/product-title";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { card } from "./styles";
import { TrustMetrics } from "./trust-metrics";

// Shared with the placeholder, so both take the same room.
const PHOTO = "aspect-square w-full border-b border-line";
const BODY = "flex flex-1 flex-col gap-2.5 p-3 sm:p-4";
const TITLE = "line-clamp-2 text-[15px] leading-snug font-semibold";
const TAGS = "mt-auto flex flex-wrap gap-1.5 text-xs font-semibold text-ink";
const TAG = "inline-flex items-center gap-1 rounded-full px-2.5 py-1";

/**
 * A hot product (home carousel, /hot): photo, AliExpress's Hebrew title (known transliterated loan
 * words fixed, hotTitle; the list notes the titles are machine-translated), price and the trust
 * numbers, every one from AliExpress. One link per card, to the product page (`href`, /p/<id> by
 * default): the title's link covers the whole card. No prefetch: a product page older than a day
 * refreshes from AliExpress, and a row of cards would do that for every card on screen.
 */
export function HotProductCard({
  product,
  now,
  sizes,
  preload,
  href = `/p/${encodeURIComponent(product.productId)}`,
}: {
  product: HotProduct;
  /** For the promo code tag, shown only while the code is valid. */
  now: Date;
  sizes: string;
  /** For the first cards of /hot, whose photos are the largest paint on phones. */
  preload?: boolean;
  href?: string;
}) {
  const withCode = hasCurrentCode(product, now);
  return (
    <article
      // The focus ring of the card-wide link goes around the card.
      className={`${card} relative flex h-full flex-col overflow-hidden has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent`}
    >
      <ProductImage
        src={product.imageUrl}
        // The title names the product; the photo only helps scanning.
        alt=""
        className={PHOTO}
        iconClassName="size-10"
        sizes={sizes}
        preload={preload}
      />
      <div className={BODY}>
        {/* No dir="auto": many titles start with a Latin brand or model and would flip to LTR. */}
        <h3 className={TITLE}>
          <Link
            href={href}
            prefetch={false}
            className="after:absolute after:inset-0 hover:text-accent-ink focus-visible:outline-none"
          >
            {hotTitle(product.title)}
          </Link>
        </h3>
        <Price
          product={{
            price_ils: product.price,
            original_price_ils: product.originalPrice,
            price_is_approx: false,
            discount_pct: product.discountPct,
          }}
          size="sm"
        />
        <TrustMetrics
          product={{
            positive_feedback_pct: product.positiveFeedbackPct,
            units_sold: product.unitsSold,
          }}
          short
        />
        {(withCode || product.hasVideo) && (
          <ul className={TAGS}>
            {withCode && (
              <li className={`${TAG} bg-gold-soft`}>
                <TicketPercent aria-hidden className="size-3.5" />
                קוד הנחה
              </li>
            )}
            {product.hasVideo && (
              <li className={`${TAG} bg-surface-2`}>
                <Clapperboard aria-hidden className="size-3.5" />
                סרטון
              </li>
            )}
          </ul>
        )}
      </div>
    </article>
  );
}

/** Numbers as wide as common real ones, so the invisible lines below wrap like a card's. */
const SAMPLE = { price: 123.45, originalPrice: 234.56, discountPct: 47, pct: 96.5, sold: 1234 };

const bar = "animate-pulse rounded-full bg-surface-2";

/**
 * A card's shape for a placeholder (aria-hidden by its caller): the photo, two title lines, and
 * an invisible price, trust numbers and tag row, so it is as tall as a card with a video tag.
 */
export function HotProductCardPlaceholder() {
  return (
    <div className={`${card} flex h-full flex-col overflow-hidden`}>
      <div className={`${PHOTO} animate-pulse bg-surface-2`} />
      <div className={BODY}>
        <div className={`${TITLE} min-h-[2lh]`}>
          <div className={`mt-1 h-4 w-5/6 ${bar}`} />
        </div>
        <div className="relative">
          <div className="invisible">
            <Price
              product={{
                price_ils: SAMPLE.price,
                original_price_ils: SAMPLE.originalPrice,
                price_is_approx: false,
                discount_pct: SAMPLE.discountPct,
              }}
              size="sm"
            />
          </div>
          <div className={`absolute inset-y-0 start-0 w-16 ${bar}`} />
        </div>
        <div className="invisible">
          <TrustMetrics
            product={{ positive_feedback_pct: SAMPLE.pct, units_sold: SAMPLE.sold }}
            short
          />
        </div>
        <div className={`${TAGS} invisible`}>
          <span className={TAG}>
            <Clapperboard aria-hidden className="size-3.5" />
            סרטון
          </span>
        </div>
      </div>
    </div>
  );
}
