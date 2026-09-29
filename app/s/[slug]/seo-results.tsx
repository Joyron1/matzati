// The products of an SEO landing page (/s/[slug], owner decisions 2026-09-29): every group of five
// the page's stored results show (lib/seo/results.ts), in ranked order. From xl a five-column
// grid: place 1 is a large card over three columns and two rows, the other four of its group two
// by two beside it, and every later group one row of five equal tiles under a small divider
// ("מקומות 6–10"), so a line's "מבין החמישה" is visibly about its own row. Below xl, place 1 on top
// and the rest a list of row cards. Every group is in the server HTML; GroupReveal shows one more
// each time the visitor reaches the bottom. Also rendered by the dev preview (/dev/preview/seo-page).
import Link from "next/link";
import { Search, Trophy } from "lucide-react";
import { BuyButton } from "@/components/buy-button";
import { TitleText } from "@/components/card-lines";
import { Price } from "@/components/price";
import { CompactProductCard } from "@/components/product-cards";
import { ProductImage } from "@/components/product-image";
import { GroupReveal } from "@/components/seo-group-reveal";
import { btnLg, btnMd, btnSecondary, featured } from "@/components/styles";
import { TrustMetrics } from "@/components/trust-metrics";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime } from "@/lib/format";
import { FILTERS } from "@/lib/ranking/config";
import { searchHref } from "@/lib/search-url";
import { staleFetchedAt } from "@/lib/search/freshness";
import { lastPlace } from "@/lib/seo/places";
import type { FilterChip, ResultProduct } from "@/lib/types";

/** Click source logged by /go for every buy button on these pages. */
export const SEO_SRC = "seo";

function productHref(id: string, q: string) {
  return `/p/${encodeURIComponent(id)}?q=${encodeURIComponent(q)}`;
}

/**
 * When the results and their prices were fetched from AliExpress. The stored results are up to
 * about a week old, so once they are older than STALE_RESULTS_HOURS the line says prices may have
 * changed since (the buy button leads to AliExpress's current price).
 */
function CheckedAt({ iso, stale }: { iso: string; stale: boolean }) {
  return (
    <p className="text-sm text-muted">
      התוצאות והמחירים נבדקו ב־<time dateTime={iso}>{formatDateTime(iso)}</time>.
      {stale && " ייתכן שהמחירים השתנו מאז."}
    </p>
  );
}

/** The page's title, the admin's intro and when its results were checked. */
export function SeoPageHeader({
  title,
  intro,
  checkedAt,
  now,
}: {
  title: string;
  intro: string | null;
  checkedAt: string | null;
  now: Date;
}) {
  return (
    <header className="max-w-3xl space-y-3">
      <h1 className="font-display text-[2rem] leading-tight text-balance sm:text-5xl">{title}</h1>
      {intro && <p className="text-lg leading-relaxed text-muted">{intro}</p>}
      {checkedAt && <CheckedAt iso={checkedAt} stale={staleFetchedAt(checkedAt, now) !== null} />}
    </header>
  );
}

/** "הבנתי ככה" chips as plain labels: on this page they describe the search, nothing to remove. */
function ReadOnlyChips({ chips }: { chips: FilterChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-sm font-semibold text-muted">הבנתי ככה:</span>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li
            key={chip.id}
            className="rounded-full bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent-ink"
          >
            {chip.label_he}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Place 1: the featured card with the buy button logged as "seo" (FeaturedProductCard hard-codes
 * its click source). From xl it fills its three columns and two rows, the photo taking the height
 * the text leaves.
 */
function FeaturedCard({ product, q }: { product: ResultProduct; q: string }) {
  const href = productHref(product.product_id, q);
  return (
    <article className={`${featured} flex flex-col gap-5 p-4 sm:p-6 xl:col-span-3 xl:row-span-2`}>
      <div className="relative xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <ProductImage
          src={product.image_urls[0]}
          alt={product.title_he}
          className="aspect-[4/3] w-full rounded-card xl:aspect-auto xl:min-h-72 xl:flex-1"
          iconClassName="size-24"
          sizes="(min-width: 1280px) 700px, (min-width: 768px) 720px, 92vw"
          preload
        />
        <span className="absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1.5 text-sm font-bold text-on-gold">
          <Trophy aria-hidden className="size-4" />
          מקום 1 בדירוג
        </span>
      </div>

      <div className="space-y-3">
        <h3 className="text-xl leading-snug font-bold sm:text-2xl">
          <Link href={href} className="block hover:text-accent-ink">
            <TitleText title={product.title_he} />
          </Link>
        </h3>
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
        <BuyButton productId={product.product_id} src={SEO_SRC} position={1} />
        <Link href={href} className={`${btnSecondary} ${btnLg}`}>
          לפרטים
        </Link>
      </div>
    </article>
  );
}

/** One group of five: its divider ("מקומות 6–10"; read only by screen readers for the first). */
function Group({ products, first, q }: { products: ResultProduct[]; first: number; q: string }) {
  const id = `seo-places-${first}`;
  const last = lastPlace(first, products.length);
  const [lead, ...rest] = products;
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2
        id={id}
        className={
          first === 1
            ? "sr-only"
            : "flex items-center gap-3 text-sm font-semibold text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
        }
      >
        {last === first ? (
          <span>
            מקום <bdi dir="ltr">{first}</bdi>
          </span>
        ) : (
          <span>
            מקומות{" "}
            <bdi dir="ltr">
              {first}–{last}
            </bdi>
          </span>
        )}
      </h2>
      <div className="mx-auto grid max-w-3xl gap-4 xl:max-w-none xl:grid-cols-5">
        {first === 1 && lead && <FeaturedCard product={lead} q={q} />}
        {(first === 1 ? rest : products).map((p, i) => {
          const rank = first + i + (first === 1 ? 1 : 0);
          return (
            <CompactProductCard
              key={p.product_id}
              product={p}
              rank={rank}
              q={q}
              src={SEO_SRC}
              tile
            />
          );
        })}
      </div>
    </section>
  );
}

function SearchYourself({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-2 text-center">
      <p className="text-muted">רוצים לשנות את התקציב או להוסיף דרישה?</p>
      <Link href={searchHref({ q: query })} className={`${btnSecondary} ${btnMd}`}>
        <Search aria-hidden className="size-[18px]" />
        חפשו בעצמכם
      </Link>
    </div>
  );
}

export interface SeoResultsViewProps {
  query: string;
  chips: FilterChip[];
  checkedCount: number;
  passedCount: number;
  /** The groups shown, in order (shownGroups). */
  groups: ResultProduct[][];
  /** "חפשו בעצמכם" (off in the dev preview, which never links to /search). */
  searchLink?: boolean;
}

export function SeoResultsView({
  query,
  chips,
  checkedCount,
  passedCount,
  groups,
  searchLink = true,
}: SeoResultsViewProps) {
  const shown = groups.flat();
  const firsts = groups.map((_, k) => groups.slice(0, k).reduce((n, g) => n + g.length, 0) + 1);
  const hasPriceFilter = chips.some((c) => c.kind === "max_price" || c.kind === "min_price");

  return (
    <section aria-label="המוצרים שעברו את הסינון" className="space-y-6">
      <div className="max-w-3xl space-y-4">
        <ReadOnlyChips chips={chips} />
        <div className="space-y-1">
          <p className="text-xl font-bold">
            בדקנו <bdi dir="ltr">{formatCount(checkedCount)}</bdi> מוצרים.{" "}
            <span className="text-accent-ink">
              <bdi dir="ltr">{formatCount(passedCount)}</bdi> עברו את הסינון.
            </span>
          </p>
          <p className="text-sm text-muted">
            {/* Same rule as /search: when the second trust tier filled in, one pair of numbers
                would be false for some cards, so the line names the criteria instead. */}
            {shown.some((p) => p.passed_tier === "fill") ? (
              <>
                הסינון: משוב חיובי ומספר מכירות ב־30 הימים האחרונים לפי{" "}
                <Link
                  href="/terms#accuracy"
                  className="underline underline-offset-4 hover:text-ink"
                >
                  הספים שלנו
                </Link>
              </>
            ) : (
              <>
                הסינון: <bdi dir="ltr">{FILTERS.minPositiveFeedbackPct}%</bdi> משוב חיובי ומעלה ו־
                <bdi dir="ltr">{formatCount(FILTERS.minUnitsSold)}</bdi> מכירות ומעלה ב־30 הימים
                האחרונים
              </>
            )}
            {hasPriceFilter ? ", בתוך התקציב" : ""}.
            {shown.length < passedCount && (
              <>
                {" "}
                כאן <bdi dir="ltr">{shown.length}</bdi> הראשונים בדירוג שלנו.
              </>
            )}
            {groups.length > 1 && (
              <>
                {" "}
                המוצרים מוצגים בקבוצות של {RESULTS_PER_PAGE}, והשוואה בהסבר (כמו ״הזול מבין החמישה״)
                היא בתוך הקבוצה של המוצר.
              </>
            )}
            {shown.some((p) => p.price_is_approx) && <> {APPROX_PRICE_NOTE}</>}
          </p>
        </div>
      </div>

      <GroupReveal counts={groups.map((g) => g.length)}>
        {groups.map((g, k) => (
          <Group key={firsts[k]} products={g} first={firsts[k]} q={query} />
        ))}
      </GroupReveal>

      {searchLink && <SearchYourself query={query} />}
    </section>
  );
}
