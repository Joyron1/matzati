import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import {
  RecentSearchesStrip,
  RecentSearchesStripPlaceholder,
} from "@/components/recent-searches-strip";
import { SaleCountdown } from "@/components/sale-countdown";
import { SearchComposer } from "@/components/search-composer";
import { SearchIdeas, SearchTips } from "@/components/search-guide";
import { card } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { nextSale } from "@/lib/deals/queries";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
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
    // Both tiers (lib/ranking/config.ts): the fill tier only tops up to 3 results.
    body: `רק מוצרים עם ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות ${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים. אם אין מספיק, משלימים ממוצרים עם ${FILL_TIER.minPositiveFeedbackPct}% ומעלה ולפחות ${FILL_TIER.minUnitsSold} מכירות. כל המספרים מאלי אקספרס.`,
  },
  {
    Icon: ListChecks,
    title: "בוחרים מתוך 3",
    body: "ליד כל מוצר כתוב למה הוא נבחר. אפשר להסיר סינון ולחפש שוב בלחיצה.",
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
  return (
    <SaleCountdown
      title={sale.title}
      startsAt={sale.starts_at}
      endsAt={sale.ends_at}
      renderedAt={now.getTime()}
      moreHref="/sales"
    />
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
      {/* One centered column: the composer is the focal point, hot searches right under it. */}
      <section aria-labelledby="hero-title" className="relative isolate">
        {/* A soft cobalt glow behind the hero; clipped here so it never widens the page. */}
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden">
          <div className="mx-auto h-full max-w-5xl bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)]" />
        </div>
        {/* Tighter on phones, so the whole composer and the first hot searches fit the screen. */}
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
            <span className="block text-balance text-accent">קבלו 3 מוצרים שעברו סינון.</span>
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

        {/* Wider than the composer, so 6 pills fit in one row on desktop. */}
        <div className="mx-auto mt-5 max-w-5xl px-4 sm:mt-6 sm:px-6">
          <Suspense fallback={<RecentSearchesStripPlaceholder />}>
            <RecentSearchesStrip />
          </Suspense>
        </div>
      </section>

      {/* One section gap (mt-16 sm:mt-20) between the page's sections. */}
      <div className="mx-auto mt-16 grid max-w-6xl gap-4 px-4 sm:mt-20 sm:px-6 lg:grid-cols-2 lg:gap-6">
        <SearchTips />
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

      <div className="mx-auto mt-6 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-2">
        <Suspense fallback={null}>
          <NextSale />
        </Suspense>
        {/* Full width when there is no sale card next to it. */}
        <section
          aria-labelledby="trust-title"
          className={`${card} flex flex-col gap-4 p-6 sm:p-7 md:only:col-span-2`}
        >
          <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <h2 id="trust-title" className="font-display text-2xl">
            איך אנחנו מרוויחים
          </h2>
          <p className="max-w-3xl leading-relaxed text-muted">
            כשאתם קונים דרך הקישורים שלנו, אלי אקספרס משלמת לנו עמלה קטנה. המחיר שלכם לא משתנה.
            העמלה לא משפיעה על הדירוג: מוצר לא יעלה למעלה רק כי הוא משלם לנו יותר.
          </p>
          <Link
            href="/disclosure"
            className="mt-auto inline-flex min-h-11 items-center self-start font-semibold text-accent-ink underline-offset-4 hover:underline"
          >
            לגילוי הנאות המלא
          </Link>
        </section>
      </div>

      <Suspense fallback={null}>
        <PopularSearches />
      </Suspense>
    </>
  );
}
