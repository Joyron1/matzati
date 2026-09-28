import Link from "next/link";
import { Trophy } from "lucide-react";
import type { LoggedResult } from "@/lib/search-url";
import { BuyButton } from "./buy-button";
import { StreamedLine, TitleText, type FinalResults } from "./card-lines";
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
  /**
   * The results page while this card's lines are being written (plan item 15): the finished
   * results, whose Hebrew title and line replace the ones shown now. Room for them is kept from the
   * start (the title's two lines; the line's lines on phones, where a 120-character line takes 4 of
   * the featured box at 360-390 px, and two from sm), so nothing below moves when they come.
   */
  final?: FinalResults;
}

function productHref(id: string, q: string) {
  const path = `/p/${encodeURIComponent(id)}`;
  return q ? `${path}?q=${encodeURIComponent(q)}` : path;
}

/**
 * The card's title (TitleText: AliExpress's English one until ours is written, or when it was
 * rejected) and line: as they are, or streamed in place when `final` is given. `clamp`: the title
 * at most two lines; `bars`: the placeholder lines of the room kept for the line.
 */
function lines(
  { product, final }: Pick<CardProps, "product" | "final">,
  { clamp, bars }: { clamp: boolean; bars: 2 | 3 },
) {
  if (!final) {
    return { title: <TitleText title={product.title_he} clamp={clamp} />, why: product.why_he };
  }
  const id = product.product_id;
  return {
    title: (
      <StreamedLine
        final={final}
        id={id}
        field="title_he"
        interim={product.title_he}
        clamp={clamp}
      />
    ),
    why: <StreamedLine final={final} id={id} field="why_he" interim={product.why_he} bars={bars} />,
  };
}

export function FeaturedProductCard({ product, rank, q, final }: CardProps) {
  const href = productHref(product.product_id, q);
  // While the lines stream, the title is kept to two lines (their room is kept).
  const { title, why } = lines({ product, final }, { clamp: Boolean(final), bars: 3 });
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
        <h2 className={`text-xl leading-snug font-bold sm:text-2xl ${final ? "min-h-[2lh]" : ""}`}>
          <Link href={href} className="block hover:text-accent-ink">
            {title}
          </Link>
        </h2>
        {(final || product.why_he) && (
          <p
            className={`rounded-2xl bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-accent-ink ${
              final ? "min-h-[calc(4lh_+_1.5rem)] sm:min-h-[calc(2lh_+_1.5rem)]" : ""
            }`}
          >
            <span className="font-bold">למה בחרנו: </span>
            {why}
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
  final,
}: CardProps & { src?: string }) {
  const href = productHref(product.product_id, q);
  const { title, why } = lines({ product, final }, { clamp: true, bars: 2 });
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
          <h3 className={`leading-snug font-semibold ${final ? "min-h-[2lh]" : ""}`}>
            <Link href={href} className="block hover:text-accent-ink">
              {title}
            </Link>
          </h3>
          <Price product={product} size="sm" />
        </div>
      </div>
      <TrustMetrics product={product} short />
      {(final || product.why_he) && (
        <p
          // A 117-character line takes a fourth line under 340 px.
          className={`text-sm leading-relaxed text-muted ${
            final ? "min-h-[4lh] min-[340px]:min-h-[3lh] sm:min-h-[2lh]" : ""
          }`}
        >
          {why}
        </p>
      )}
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
