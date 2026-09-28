import Link from "next/link";
import { Trophy } from "lucide-react";
import { hasHebrew } from "@/lib/product-title";
import type { LoggedResult } from "@/lib/search-url";
import { BuyButton } from "./buy-button";
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
 * The card title. Without a Hebrew title of ours (a rejected or failed explain line) it is
 * AliExpress's English title, isolated left to right so its numbers and punctuation stay in order.
 */
function CardTitle({ title }: { title: string }) {
  return hasHebrew(title) ? title : <bdi dir="ltr">{title}</bdi>;
}

export function FeaturedProductCard({ product, rank, q }: CardProps) {
  const href = productHref(product.product_id, q);
  return (
    <article className={`${featured} flex flex-col gap-5 p-4 sm:p-6`}>
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

      <div className="space-y-3">
        <h2 className="text-xl leading-snug font-bold sm:text-2xl">
          <Link href={href} className="hover:text-accent-ink">
            <CardTitle title={product.title_he} />
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

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
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
    <article className={`${card} flex flex-col gap-4 p-4`}>
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
          <h3 className="line-clamp-2 leading-snug font-semibold">
            <Link href={href} className="hover:text-accent-ink">
              <CardTitle title={product.title_he} />
            </Link>
          </h3>
          <Price product={product} size="sm" />
        </div>
      </div>
      <TrustMetrics product={product} short />
      {product.why_he && <p className="text-sm leading-relaxed text-muted">{product.why_he}</p>}
      <div className="mt-auto grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
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
