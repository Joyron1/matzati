import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloudOff, SearchX } from "lucide-react";
import { SearchComposer } from "@/components/search-composer";
import { StateCard } from "@/components/state-card";
import { BRAND } from "@/lib/config/brand";
import { siteUrl } from "@/lib/config/site";
import { formatCount } from "@/lib/format";
import { seoPageView } from "@/lib/seo/page-view";
import { shownGroups } from "@/lib/seo/results";
import { seoPath } from "@/lib/seo/slug";
import { itemListJsonLd, jsonLdScript, seoDescription, seoTitle } from "@/lib/seo/structured-data";
import { SeoPageHeader, SeoResultsView } from "./seo-results";

// Landing pages are generated on the first visit and regenerated in the background (ISR), never
// at build time. They show the page's stored results (lib/seo/page-view.ts), which a refresh
// replaces about weekly and then revalidates the page; only a page without stored results runs a
// real search, and a build must not spend the LLM or AliExpress budget. Only slugs of published
// rows render; any other slug is a 404 without a search.
export const revalidate = 86400;
export const dynamicParams = true;
// A page without stored results runs one visitor-style search (parse, up to 3 AliExpress calls,
// explain one page of five): 7-15 s; give it room. Its stored results (up to 50 products) are
// collected by the refresh, never at render time.
export const maxDuration = 60;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

interface LandingPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: LandingPageProps): Promise<Metadata> {
  const view = await seoPageView((await params).slug);
  if (!view) return { title: "הדף לא נמצא", robots: { index: false } };
  const { page, results } = view;
  const url = `${siteUrl()}${seoPath(page.slug)}`;
  const title = seoTitle(page);
  const description = seoDescription(page);
  const top = results ? shownGroups(results)[0]?.[0] : undefined;
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
      // The image is ./opengraph-image.tsx: the page's title over its first results' photos.
    },
    // Without results the page is only a search box: keep it out of the index until it has some.
    ...(top ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function SeoLandingPage({ params }: LandingPageProps) {
  const view = await seoPageView((await params).slug);
  if (!view) notFound();
  const { page, results, checkedAt } = view;
  const origin = siteUrl();
  const groups = results ? shownGroups(results) : [];
  const shown = groups.flat();

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-6 sm:px-6 sm:pt-10 xl:max-w-7xl">
      {shown.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              itemListJsonLd({
                origin,
                pageUrl: `${origin}${seoPath(page.slug)}`,
                name: page.title_he,
                products: shown,
              }),
            ),
          }}
        />
      )}

      <SeoPageHeader
        title={page.title_he}
        intro={page.intro_he}
        checkedAt={checkedAt}
        // Rendered by ISR: "now" is when the page was generated, at most a day before it shows.
        now={new Date()}
      />

      {results === null ? (
        <Unavailable query={page.query} />
      ) : shown.length === 0 ? (
        <NoResults checkedCount={results.checked_count} query={page.query} />
      ) : (
        <SeoResultsView
          query={page.query}
          chips={results.chips}
          checkedCount={results.checked_count}
          passedCount={results.passed_count}
          groups={groups}
        />
      )}
    </div>
  );
}

function NoResults({ checkedCount, query }: { checkedCount: number; query: string }) {
  return (
    <StateCard Icon={SearchX} title="כרגע אין מוצרים שעוברים את הסינון">
      <p className="max-w-md leading-relaxed text-muted">
        {checkedCount > 0 ? (
          <>
            בדקנו <bdi dir="ltr">{formatCount(checkedCount)}</bdi> מוצרים ואף אחד לא עבר.{" "}
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
