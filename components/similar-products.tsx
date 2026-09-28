import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { HOT_TITLES_NOTE } from "@/lib/hot/copy";
import { hasHebrew } from "@/lib/product-title";
import type { SimilarItem, SimilarProducts as SimilarData } from "@/lib/similar/select";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { card } from "./styles";
import { TrustMetrics } from "./trust-metrics";

export const SIMILAR_TITLE = "מוצרים דומים שיעניינו אתכם";

/** The muted line under the heading: where the products come from and when prices were checked. */
export function similarSourceLine(data: SimilarData): string {
  const checked = `המחירים נבדקו באלי אקספרס ב־${formatDateTime(data.checkedAt)}.`;
  if (data.source.kind === "search") {
    return `מאותו חיפוש, בסדר שבו דירגנו אותם. ${checked}`;
  }
  const where = data.source.categoryHe ? ` בקטגוריה ${data.source.categoryHe}` : "";
  return `מרשימת המוצרים החמים${where}, לפי מספר המכירות. ${checked} ${HOT_TITLES_NOTE}`;
}

/**
 * A title in the direction of its letters: an English AliExpress title reads left to right but
 * stays aligned with the Hebrew around it (as on the result cards), clamped to two lines.
 */
function CardTitle({ title }: { title: string }) {
  if (hasHebrew(title)) return <span className="line-clamp-2">{title}</span>;
  return (
    <span dir="ltr" lang="en" className="line-clamp-2 text-end">
      {title}
    </span>
  );
}

/**
 * One compact card: photo, title, price and AliExpress's numbers (with the shared-numbers note of
 * a search result). The title's link covers the card. No prefetch: a product page older than a day
 * refreshes from AliExpress, and a row of cards would do that for every card on screen.
 */
function SimilarCard({ item }: { item: SimilarItem }) {
  return (
    <article
      // The focus ring of the card-wide link goes around the card.
      className={`${card} relative flex h-full flex-col overflow-hidden has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent`}
    >
      <ProductImage
        src={item.imageUrl ?? undefined}
        // The title names the product; the photo only helps scanning.
        alt=""
        className="aspect-square w-full border-b border-line"
        iconClassName="size-10"
        sizes="(min-width: 1024px) 260px, (min-width: 640px) 30vw, 46vw"
      />
      <div className="flex flex-1 flex-col gap-2.5 p-3 sm:p-4">
        <h3 className="text-[15px] leading-snug font-semibold">
          {/* Two lines kept for every title, so the prices of a row line up (and the link itself
              is 44px tall, though the whole card is its target). */}
          <Link
            href={item.href}
            prefetch={false}
            className="block min-h-11 after:absolute after:inset-0 hover:text-accent-ink focus-visible:outline-none"
          >
            <CardTitle title={item.title} />
          </Link>
        </h3>
        <Price product={item.price} size="sm" />
        <TrustMetrics product={item.trust} short />
      </div>
    </article>
  );
}

/**
 * "מוצרים דומים שיעניינו אתכם" on /p: other products of the search or hot list that led to the page
 * (lib/similar), in that list's order, each linking to its own /p. Renders nothing without items.
 */
export function SimilarProducts({
  data,
  className = "",
}: {
  data: SimilarData | null;
  className?: string;
}) {
  if (!data?.items.length) return null;
  return (
    <section aria-labelledby="similar-title" className={`space-y-4 ${className}`}>
      <div className="space-y-1">
        <h2 id="similar-title" className="font-display text-2xl">
          {SIMILAR_TITLE}
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">{similarSourceLine(data)}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {data.items.map((item) => (
          <li key={item.productId} className="min-w-0">
            <SimilarCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
