// The AliExpress item a visitor pasted as a link (owner request 2026-11-01), above the similar
// products the link search finds: a new item with no sales yet (a Xiaomi H50) never comes back
// from product.query, so without it the visitor saw nothing of what they asked for. Its own
// numbers, and a plain note when it has not passed our filters. Nothing while the id has no row.
import Link from "next/link";
import { Link2 } from "lucide-react";
import { BuyButton } from "@/components/buy-button";
import { CardBadges } from "@/components/card-badges";
import { TitleText } from "@/components/card-lines";
import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { DETAILS_LABEL } from "@/components/product-cards";
import { aboveCardLink, btnLg, btnSecondary, card, cardLink, linkCard } from "@/components/styles";
import { TrustMetrics } from "@/components/trust-metrics";
import { linkedProduct } from "@/lib/search/server";

export async function LinkedProduct({ productId, q }: { productId: string; q: string }) {
  const product = await linkedProduct(productId);
  if (!product) return null;
  const href = `/p/${encodeURIComponent(product.product_id)}?q=${encodeURIComponent(q)}`;
  const vetted = product.passed_tier === "standard" || product.passed_tier === "fill";
  return (
    <section aria-labelledby="linked-title" className="space-y-3">
      <h2 id="linked-title" className="flex items-center gap-2 text-lg font-bold text-ink">
        <Link2 aria-hidden className="size-5 text-accent-ink" />
        המוצר מהקישור שלך
      </h2>
      <article
        className={`${card} ${linkCard} grid gap-4 p-4 sm:grid-cols-[12rem_1fr] sm:gap-6 sm:p-5`}
      >
        <ProductImage
          src={product.image_urls[0]}
          alt=""
          className="aspect-square w-full max-w-56 rounded-card sm:max-w-none"
          iconClassName="size-12"
          sizes="(min-width: 640px) 192px, 60vw"
          preload
        />
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-lg leading-snug font-bold">
            <Link href={href} data-card-link className={`block hover:text-accent-ink ${cardLink}`}>
              <TitleText title={product.title_he} />
            </Link>
          </h3>
          <Price product={product} />
          <CardBadges product={product} />
          <TrustMetrics product={product} />
          {!vetted && (
            <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
              המוצר הזה לא עבר את הסינון שלנו: יש לו מעט מכירות או מעט משוב באלי אקספרס (למשל מוצר
              חדש). כדאי לקרוא את הביקורות באלי אקספרס לפני שקונים.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <BuyButton productId={product.product_id} src="search_linked" raised />
            <Link href={href} className={`${btnSecondary} ${btnLg} ${aboveCardLink}`}>
              {DETAILS_LABEL}
            </Link>
          </div>
        </div>
      </article>
    </section>
  );
}
