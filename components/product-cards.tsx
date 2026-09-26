import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Trophy } from "lucide-react";
import type { ResultProduct } from "@/lib/types";
import { BuyButton } from "./buy-button";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { btnLg, btnMd, btnSecondary, card, featured } from "./styles";
import { TrustMetrics } from "./trust-metrics";

interface CardProps {
  product: ResultProduct;
  rank: number;
  /** Query that produced this result, so the product page can link back. */
  q: string;
  icon?: LucideIcon;
}

function productHref(id: string, q: string) {
  return q ? `/p/${id}?q=${encodeURIComponent(q)}` : `/p/${id}`;
}

export function FeaturedProductCard({ product, rank, q, icon }: CardProps) {
  const href = productHref(product.product_id, q);
  return (
    <article className={`${featured} flex flex-col gap-5 p-4 sm:p-6`}>
      <div className="relative">
        <ProductImage
          src={product.image_urls[0]}
          alt={product.title_he}
          fallbackIcon={icon}
          className="aspect-[4/3] w-full rounded-card"
          iconClassName="size-24"
          priority
        />
        <span className="absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1.5 text-sm font-bold text-on-gold">
          <Trophy aria-hidden className="size-4" />
          מקום {rank} בדירוג
        </span>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl leading-snug font-bold sm:text-2xl">
          <Link href={href} className="hover:text-accent-ink">
            {product.title_he}
          </Link>
        </h2>
        <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-accent-ink">
          <span className="font-bold">למה בחרנו: </span>
          {product.why_he}
        </p>
      </div>

      <div className="space-y-3">
        <Price product={product} size="lg" />
        <TrustMetrics product={product} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <BuyButton productId={product.product_id} src="search_featured" />
        <Link href={href} className={`${btnSecondary} ${btnLg}`}>
          לפרטים
        </Link>
      </div>
    </article>
  );
}

export function CompactProductCard({ product, rank, q, icon }: CardProps) {
  const href = productHref(product.product_id, q);
  return (
    <article className={`${card} flex flex-col gap-4 p-4`}>
      <div className="flex gap-4">
        <ProductImage
          src={product.image_urls[0]}
          alt={product.title_he}
          fallbackIcon={icon}
          className="size-24 shrink-0 rounded-tile sm:size-28"
          iconClassName="size-10"
          sizes="112px"
        />
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold text-muted">מקום {rank} בדירוג</p>
          <h3 className="line-clamp-2 leading-snug font-semibold">
            <Link href={href} className="hover:text-accent-ink">
              {product.title_he}
            </Link>
          </h3>
          <Price product={product} size="sm" />
        </div>
      </div>
      <TrustMetrics product={product} />
      <p className="text-sm leading-relaxed text-muted">{product.why_he}</p>
      <div className="mt-auto grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
        <BuyButton productId={product.product_id} src="search_compact" size="md" />
        <Link href={href} className={`${btnSecondary} ${btnMd}`}>
          לפרטים
        </Link>
      </div>
    </article>
  );
}
