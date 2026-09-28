import Link from "next/link";
import { Trophy } from "lucide-react";
import type { LoggedResult } from "@/lib/search-url";
import { BuyButton } from "./buy-button";
import { TitleText } from "./card-lines";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { btnLg, btnMd, btnSecondary, featured, card } from "./styles";
import { TrustMetrics } from "./trust-metrics";

interface CardProps {
  /** A result; search_uid (when the search was logged for this visitor) goes to /go with rank. */
  product: LoggedResult;
  rank: number;
  /** Query that produced this result, so the product page can link back. */
  q: string;
}

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
    <article className={`${featured} @container p-4 sm:p-6`}>
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
              <Link href={href} className="block hover:text-accent-ink">
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
            />
            <Link href={href} className={`${btnSecondary} ${btnLg}`}>
              לפרטים
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CompactProductCard({
  product,
  rank,
  q,
  src = "search_compact",
}: CardProps & { src?: string }) {
  const href = productHref(product.product_id, q);
  return (
    // A container: in a narrow column (two compact cards side by side) its buttons stack.
    <article className={`${card} @container flex flex-col gap-4 p-4`}>
      <div className="flex gap-4">
        <ProductImage
          src={product.image_urls[0]}
          alt={product.title_he}
          className="size-24 shrink-0 rounded-tile sm:size-28"
          iconClassName="size-10"
          sizes="112px"
        />
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold text-muted">מקום {rank} בדירוג</p>
          <h3 className="leading-snug font-semibold">
            <Link href={href} className="block hover:text-accent-ink">
              <TitleText title={product.title_he} clamp />
            </Link>
          </h3>
          <Price product={product} size="sm" />
        </div>
      </div>
      <TrustMetrics product={product} short />
      {product.why_he && <p className="text-sm leading-relaxed text-muted">{product.why_he}</p>}
      <div className="mt-auto grid gap-2 @[19rem]:grid-cols-[1fr_auto] @[19rem]:items-start">
        <BuyButton
          productId={product.product_id}
          src={src}
          searchUid={product.search_uid}
          position={rank}
          size="md"
        />
        <Link href={href} className={`${btnSecondary} ${btnMd}`}>
          לפרטים
        </Link>
      </div>
    </article>
  );
}
