import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ListChecks, MessageSquareText, Sparkles, SlidersHorizontal } from "lucide-react";
import { HomeFaq } from "@/components/home-faq";
import {
  HotProductsCarousel,
  HotProductsCarouselPlaceholder,
} from "@/components/hot-products-carousel";
import {
  RecentSearchesStrip,
  RecentSearchesStripPlaceholder,
} from "@/components/recent-searches-strip";
import { SaleCountdown } from "@/components/sale-countdown";
import { SearchComposer } from "@/components/search-composer";
import { SearchIdeas } from "@/components/search-guide";
import { card } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { RESULTS_FIRST_VIEW, RESULTS_PER_PAGE } from "@/lib/config/site";
import { nextSale } from "@/lib/deals/queries";
import { FILL_TIER, FILL_UP_TO, FILTERS } from "@/lib/ranking/config";
import { popularSearches } from "@/lib/seo/queries";
import { seoPath } from "@/lib/seo/slug";

const STEPS = [
  {
    Icon: MessageSquareText,
    title: "כותבים בעברית",
    body: "מה צריך, למי ובאיזה תקציב. לא צריך לנחש מילות חיפוש באנגלית.",
  },
  {
    Icon: SlidersHorizontal,
    title: "אנחנו מסננים",
    // Both tiers (lib/ranking/config.ts): the fill tier only tops up to the first view (FILL_UP_TO).
    body: `רק מוצרים עם ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות ${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים. אם אין מספיק, משלימים עד ${FILL_UP_TO} תוצאות ממוצרים עם ${FILL_TIER.minPositiveFeedbackPct}% ומעלה ולפחות ${FILL_TIER.minUnitsSold} מכירות. כל המספרים מאלי אקספרס.`,
  },
  {
    Icon: ListChecks,
    title: `בוחרים מתוך ${RESULTS_FIRST_VIEW}`,
    // The explained page (RESULTS_PER_PAGE) and places 6-10 under it (RESULTS_FIRST_VIEW).
    body: `ליד ${RESULTS_PER_PAGE} הראשונים כתוב למה בחרנו בהם, ומתחתם עוד ${RESULTS_FIRST_VIEW - RESULTS_PER_PAGE} שעברו את הסינון. אפשר להסיר סינון ולחפש שוב בלחיצה.`,
  },
];

/** The next big sale from the deals table (admin-managed); hidden when there is none. */
async function NextSale() {
  await connection(); // "next" depends on the time of the visit
  const now = new Date();
  const sale = await nextSale(now).catch((err: unknown) => {
    console.error(
      `[next-sale] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return null;
  });
  if (!sale?.starts_at) return null;
  // Centered like the hero, as wide as /sales shows a sale on its own.
  return (
    <div className="mx-auto mt-6 max-w-3xl px-4 sm:px-6">
      <SaleCountdown
        title={sale.title}
        startsAt={sale.starts_at}
        endsAt={sale.ends_at}
        renderedAt={now.getTime()}
        moreHref="/sales"
      />
    </div>
  );
}

/**
 * Links to the published landing pages (/s/<slug>, admin-managed). Read with the anon key, so
 * RLS shows published pages only; hidden when there are none or the read fails.
 */
async function PopularSearches() {
  const pages = await popularSearches();
  if (pages.length === 0) return null;
  return (
    <section
      aria-labelledby="popular-title"
      className="mx-auto mt-16 max-w-6xl px-4 sm:mt-20 sm:px-6"
    >
      <h2 id="popular-title" className="text-center font-display text-3xl">
        חיפושים פופולריים
      </h2>
      <ul className="mt-5 flex flex-wrap justify-center gap-2">
        {pages.map((page) => (
          <li key={page.slug} className="max-w-full">
            <Link
              href={seoPath(page.slug)}
              className="inline-flex min-h-11 max-w-full items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-accent hover:text-accent-ink"
            >
              <span className="truncate">{page.title_he}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      {/* One centered column: the composer is the focal point, the hot products right under it. */}
      <section aria-labelledby="hero-title" className="relative isolate">
        {/* A soft cobalt glow behind the hero; clipped here so it never widens the page. */}
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden">
          <div className="mx-auto h-full max-w-5xl bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)]" />
        </div>
        {/* Tighter on phones, so the whole composer and the start of the hot products fit the screen. */}
        <div className="mx-auto max-w-3xl px-4 pt-6 text-center sm:px-6 sm:pt-12 lg:pt-14">
          {/* The one line that says what the site is, on phones too. */}
          <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent-ink">
            <Sparkles aria-hidden className="size-4" />
            {BRAND.tagline}
          </p>
          <h1
            id="hero-title"
            // At 1.75rem each of the two sentences fits in one row from 360px up.
            className="mt-4 font-display text-[1.75rem] leading-[1.15] text-ink sm:mt-5 sm:text-5xl lg:text-[3.25rem]"
          >
            <span className="block text-balance">כתבו מה אתם צריכים.</span>
            <span className="block text-balance text-accent">
              קבלו {RESULTS_FIRST_VIEW} מוצרים שעברו סינון.
            </span>
          </h1>
          {/* Not on phones: the H1 and "איך זה עובד" say it too. */}
          <p className="mx-auto mt-4 hidden max-w-xl text-lg leading-relaxed text-pretty text-muted sm:block">
            אנחנו מסננים את מה שאלי אקספרס מחזירה לפי משוב של קונים ומספר מכירות, ומראים רק את מה
            שעבר.
          </p>

          <div className="mt-6 sm:mt-8">
            <SearchComposer />
          </div>
        </div>
      </section>

      {/* Right under the composer (owner request 2026-09-28): the hot products, moving on by
          themselves (components/hot-products-scroller.tsx). The carousel brings its own width and
          gutters; when it renders nothing, this margin collapses into the next one. */}
      <div className="mt-10 sm:mt-14">
        <Suspense fallback={<HotProductsCarouselPlaceholder />}>
          <HotProductsCarousel />
        </Suspense>
      </div>

      {/* As wide as the sections around it, so 6 photo tiles fit in one row on desktop. */}
      <div className="mx-auto mt-12 max-w-6xl px-4 sm:mt-16 sm:px-6">
        <Suspense fallback={<RecentSearchesStripPlaceholder />}>
          <RecentSearchesStrip />
        </Suspense>
      </div>

      {/* Compact, right under the recent searches: another way in for a visitor with no query. */}
      <div className="mt-12 sm:mt-16">
        <SearchIdeas />
      </div>

      <section
        aria-labelledby="how-title"
        className="mx-auto mt-16 max-w-6xl px-4 sm:mt-20 sm:px-6"
      >
        <h2 id="how-title" className="text-center font-display text-3xl">
          איך זה עובד
        </h2>
        {/* Three columns from lg: narrower columns would wrap step 2 into a tall block. */}
        <ol className="mt-6 grid gap-4 lg:grid-cols-3">
          {STEPS.map(({ Icon, title, body }, i) => (
            <li key={title} className={`${card} space-y-3 p-6`}>
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="text-sm font-bold text-muted">שלב {i + 1}</span>
              </div>
              <h3 className="text-lg font-bold">{title}</h3>
              <p className="leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* The affiliate disclosure is not repeated here (owner decision 2026-09-28): it lives in
          /terms#affiliate, linked from the FAQ and the footer. */}
      <Suspense fallback={null}>
        <NextSale />
      </Suspense>

      <HomeFaq />

      <Suspense fallback={null}>
        <PopularSearches />
      </Suspense>
    </>
  );
}
