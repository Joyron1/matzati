import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CloudOff, Search, SearchX, Trophy } from "lucide-react";
import { BuyButton } from "@/components/buy-button";
import { Price } from "@/components/price";
import { CompactProductCard } from "@/components/product-cards";
import { ProductImage } from "@/components/product-image";
import { SearchComposer } from "@/components/search-composer";
import { StateCard } from "@/components/state-card";
import { btnLg, btnMd, btnSecondary, featured } from "@/components/styles";
import { TrustMetrics } from "@/components/trust-metrics";
import { BRAND } from "@/lib/config/brand";
import { siteUrl } from "@/lib/config/site";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime } from "@/lib/format";
import { FILTERS } from "@/lib/ranking/config";
import { searchHref } from "@/lib/search-url";
import { seoPageView } from "@/lib/seo/page-view";
import { seoPath } from "@/lib/seo/slug";
import { itemListJsonLd, jsonLdScript, seoDescription, seoTitle } from "@/lib/seo/structured-data";
import type { FilterChip, ResultProduct, SearchResponse } from "@/lib/types";

// Landing pages are generated on the first visit and regenerated in the background (ISR), never
// at build time: each one runs a real search, and a build must not spend the LLM or AliExpress
// budget. Only slugs of published rows render; any other slug is a 404 without a search.
export const revalidate = 86400;
export const dynamicParams = true;
// A fresh search (parse, up to 3 AliExpress calls, explain) takes 7-15 s; give it room.
export const maxDuration = 60;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

/** Click source logged by /go for every buy button on these pages. */
const SEO_SRC = "seo";

interface LandingPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: LandingPageProps): Promise<Metadata> {
  const view = await seoPageView((await params).slug);
  if (!view) return { title: "הדף לא נמצא", robots: { index: false } };
  const { page, response } = view;
  const url = `${siteUrl()}${seoPath(page.slug)}`;
  const title = seoTitle(page);
  const description = seoDescription(page);
  const top = response?.results[0];
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      locale: "he_IL",
      siteName: BRAND.name,
      url,
      title,
      description,
      ...(top?.image_urls[0] ? { images: [{ url: top.image_urls[0], alt: top.title_he }] } : {}),
    },
    // Without results the page is only a search box: keep it out of the index until it has some.
    ...(top ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function SeoLandingPage({ params }: LandingPageProps) {
  const view = await seoPageView((await params).slug);
  if (!view) notFound();
  const { page, response, fetchedAt } = view;
  const origin = siteUrl();
  const results = response?.results ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-6 sm:px-6 sm:pt-10">
      {results.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              itemListJsonLd({
                origin,
                pageUrl: `${origin}${seoPath(page.slug)}`,
                name: page.title_he,
                products: results,
              }),
            ),
          }}
        />
      )}

      <header className="max-w-3xl space-y-3">
        <h1 className="font-display text-[2rem] leading-tight text-balance sm:text-5xl">
          {page.title_he}
        </h1>
        {page.intro_he && <p className="text-lg leading-relaxed text-muted">{page.intro_he}</p>}
        {fetchedAt && (
          <p className="text-sm text-muted">עודכן לאחרונה: {formatDateTime(fetchedAt)}</p>
        )}
      </header>

      {response === null ? (
        <Unavailable query={page.query} />
      ) : results.length === 0 ? (
        <NoResults response={response} query={page.query} />
      ) : (
        <Results response={response} query={page.query} />
      )}
    </div>
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

function productHref(id: string, q: string) {
  return `/p/${encodeURIComponent(id)}?q=${encodeURIComponent(q)}`;
}

/**
 * The featured card of components/product-cards.tsx with the buy button logged as "seo".
 * (FeaturedProductCard hard-codes its click source; CompactProductCard takes one.)
 */
function FeaturedCard({ product, q }: { product: ResultProduct; q: string }) {
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
          מקום 1 בדירוג
        </span>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl leading-snug font-bold sm:text-2xl">
          <Link href={href} className="hover:text-accent-ink">
            {product.title_he}
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
        <BuyButton productId={product.product_id} src={SEO_SRC} />
        <Link href={href} className={`${btnSecondary} ${btnLg}`}>
          לפרטים
        </Link>
      </div>
    </article>
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

function Results({ response, query }: { response: SearchResponse; query: string }) {
  const [top, ...rest] = response.results;
  const shown = response.results;
  const hasPriceFilter = response.chips.some(
    (c) => c.kind === "max_price" || c.kind === "min_price",
  );

  return (
    <section aria-label="המוצרים שעברו את הסינון" className="space-y-6">
      <div className="space-y-4">
        <ReadOnlyChips chips={response.chips} />
        <div className="space-y-1">
          <p className="text-xl font-bold">
            בדקנו <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> מוצרים.{" "}
            <span className="text-accent-ink">
              <bdi dir="ltr">{formatCount(response.passed_count)}</bdi> עברו את הסינון.
            </span>
          </p>
          <p className="text-sm text-muted">
            {/* Same rule as /search: when the second trust tier filled in, one pair of numbers
                would be false for some cards, so the line names the criteria instead. */}
            {shown.some((p) => p.passed_tier === "fill") ? (
              <>
                הסינון: משוב חיובי ומספר מכירות ב־30 הימים האחרונים לפי{" "}
                <Link href="/disclosure" className="underline underline-offset-4 hover:text-ink">
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
            {shown.some((p) => p.price_is_approx) && <> {APPROX_PRICE_NOTE}</>}
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <FeaturedCard product={top} q={query} />
        {rest.length > 0 && (
          <div className="grid gap-5">
            {rest.map((p, i) => (
              <CompactProductCard
                key={p.product_id}
                product={p}
                rank={i + 2}
                q={query}
                src={SEO_SRC}
              />
            ))}
          </div>
        )}
      </div>

      <SearchYourself query={query} />
    </section>
  );
}

function NoResults({ response, query }: { response: SearchResponse; query: string }) {
  return (
    <StateCard Icon={SearchX} title="כרגע אין מוצרים שעוברים את הסינון">
      <p className="max-w-md leading-relaxed text-muted">
        {response.checked_count > 0 ? (
          <>
            בדקנו <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> מוצרים ואף אחד לא
            עבר.{" "}
          </>
        ) : (
          "אלי אקספרס לא החזירה מוצרים לחיפוש הזה. "
        )}
        נסו לחפש בעצמכם, במילים אחרות או בלי סינון המחיר.
      </p>
      <div className="w-full max-w-2xl text-start">
        <SearchComposer variant="bar" defaultValue={query} />
      </div>
    </StateCard>
  );
}

function Unavailable({ query }: { query: string }) {
  return (
    <StateCard Icon={CloudOff} title="התוצאות לא זמינות כרגע">
      <p className="max-w-md leading-relaxed text-muted">
        לא הצלחנו לטעון את המוצרים לחיפוש הזה. אפשר לחפש בעצמכם, או לחזור לדף בעוד כמה דקות.
      </p>
      <div className="w-full max-w-2xl text-start">
        <SearchComposer variant="bar" defaultValue={query} />
      </div>
    </StateCard>
  );
}
