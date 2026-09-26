import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchX } from "lucide-react";
import { FilterChips } from "@/components/filter-chips";
import { CompactProductCard, FeaturedProductCard } from "@/components/product-cards";
import { SearchComposer } from "@/components/search-composer";
import { ShareLink } from "@/components/share-link";
import { ShowMore } from "@/components/show-more";
import { SortBar } from "@/components/sort-bar";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount } from "@/lib/format";
import { mockIconFor } from "@/lib/mock/icons";
import { getMockSearch } from "@/lib/mock/search";
import { FILTERS } from "@/lib/ranking/config";
import { firstParam, parseSort, parseWithout, searchHref } from "@/lib/search-url";

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const q = firstParam((await searchParams).q).trim();
  return { title: q ? `חיפוש: ${q}` : "חיפוש", robots: { index: false } };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const q = firstParam(params.q).trim().slice(0, 200);
  if (!q) redirect("/");

  const sort = parseSort(params.sort);
  const without = parseWithout(params.without);
  const { response, more } = getMockSearch({
    q,
    sort,
    without,
    empty: firstParam(params.demo) === "empty",
  });
  const [top, ...rest] = response.results;
  const priceChip = response.chips.find((c) => c.kind === "max_price" || c.kind === "min_price");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <h1 className="sr-only">תוצאות חיפוש עבור {q}</h1>
      <SearchComposer variant="bar" defaultValue={q} />

      <FilterChips
        chips={response.chips}
        q={q}
        sort={sort}
        without={without}
        highlightId={top ? undefined : priceChip?.id}
      />

      {top ? (
        <>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xl font-bold">
                בדקנו <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> מוצרים.{" "}
                <span className="text-accent-ink">
                  <bdi dir="ltr">{formatCount(response.passed_count)}</bdi> עברו את הסינון.
                </span>
              </p>
              <p className="text-sm text-muted">
                הסינון: <bdi dir="ltr">{FILTERS.minPositiveFeedbackPct}%</bdi> משוב חיובי ומעלה,{" "}
                <bdi dir="ltr">{FILTERS.minUnitsSold}</bdi> מכירות ומעלה, ובתוך התקציב.{" "}
                {APPROX_PRICE_NOTE}
              </p>
            </div>
            <SortBar q={q} sort={sort} without={without} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
            <FeaturedProductCard product={top} rank={1} q={q} icon={mockIconFor(top.product_id)} />
            <div className="grid gap-5">
              {rest.map((p, i) => (
                <CompactProductCard
                  key={p.product_id}
                  product={p}
                  rank={i + 2}
                  q={q}
                  icon={mockIconFor(p.product_id)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 pt-2">
            {response.more_available && more.length > 0 && (
              <ShowMore label="עוד 3 אפשרויות">
                <div className="grid gap-5 md:grid-cols-3">
                  {more.map((p, i) => (
                    <CompactProductCard
                      key={p.product_id}
                      product={p}
                      rank={i + 4}
                      q={q}
                      icon={mockIconFor(p.product_id)}
                    />
                  ))}
                </div>
              </ShowMore>
            )}
            <ShareLink text={`מצאתי תוצאות לחיפוש "${q}"`} label="שיתוף החיפוש בוואטסאפ" />
          </div>
        </>
      ) : (
        <section className={`${card} flex flex-col items-center gap-4 px-6 py-12 text-center`}>
          <span className="grid size-14 place-items-center rounded-full bg-gold-soft text-ink">
            <SearchX aria-hidden className="size-7" />
          </span>
          <h2 className="font-display text-2xl">לא מצאנו מוצרים שעוברים את הסינון</h2>
          <p className="max-w-md leading-relaxed text-muted">
            בדקנו <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> מוצרים ואף אחד לא עבר.{" "}
            {priceChip
              ? "נסו להוריד את סינון המחיר."
              : "נסו לכתוב את החיפוש במילים אחרות או בצורה כללית יותר."}
          </p>
          {priceChip && (
            <Link
              href={searchHref({ q, sort, without: [...without, priceChip.id] })}
              className={`${btnPrimary} ${btnMd}`}
            >
              הסרת הסינון: {priceChip.label_he}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
