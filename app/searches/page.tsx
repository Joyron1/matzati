import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, CloudOff, History, RotateCcw, SearchX, ShieldCheck } from "lucide-react";
import { FocusHashTarget } from "@/components/focus-hash-target";
import { RecentSearchCard } from "@/components/recent-search-card";
import { RecentSearchesFilters } from "@/components/recent-searches-filters";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { toRecentQuery } from "@/lib/recent/db";
import { parseRecentParams, recentHref } from "@/lib/recent/params";
import { listRecentSearches, RecentSearchesError } from "@/lib/recent/queries";
import {
  RECENT_MAX_PAGES,
  type RecentSearchFilter,
  type RecentSearchList,
} from "@/lib/recent/types";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { pageMetadata } from "@/lib/seo/page-meta";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "חיפושים אחרונים",
    description: `מה חיפשו לאחרונה ב־${BRAND.name}: חיפושים שמצאו מוצרים באלי אקספרס, בלי פרטים על מי שחיפש.`,
    path: "/searches",
  }),
  // Visitors' queries are not content for search engines; the site links are still followed.
  robots: { index: false, follow: true },
};

/** Id prefix of the card list items; "הצגת עוד חיפושים" links to the first new one. */
const CARD_ID = "recent-";

async function loadList(filter: RecentSearchFilter): Promise<RecentSearchList | null> {
  try {
    return await listRecentSearches(filter);
  } catch (err) {
    if (!(err instanceof RecentSearchesError)) throw err;
    console.error(`[recent] ${err.name}: ${err.message}`);
    return null;
  }
}

function NothingYet() {
  return (
    <StateCard Icon={History} title="עוד אין חיפושים להצגה">
      <p className="max-w-md leading-relaxed text-muted">
        חיפושים שמוצאים מוצרים יופיעו כאן. בינתיים כתבו בחיפוש מה אתם צריכים, ונציג{" "}
        {RESULTS_PER_PAGE} מוצרים שעברו את הסינון.
      </p>
      <Link href="/" className={`${btnPrimary} ${btnMd}`}>
        לחיפוש מוצר
      </Link>
    </StateCard>
  );
}

export default async function RecentSearchesPage({ searchParams }: PageProps<"/searches">) {
  const filter = parseRecentParams(await searchParams);
  const list = await loadList(filter);
  const now = new Date();

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="max-w-2xl space-y-3">
        <h1 className="font-display text-4xl sm:text-5xl">חיפושים אחרונים</h1>
        <p className="text-lg leading-relaxed text-muted">
          מה חיפשו לאחרונה ב־{BRAND.name}. לחצו על חיפוש כדי לראות את התוצאות.
        </p>
        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          החיפושים מוצגים בלי פרטים על מי שחיפש. חיפוש שלא מצא מוצרים, או שיש בו מספר טלפון, אימייל
          או קישור, לא מופיע כאן.
        </p>
      </div>

      {!list ? (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את החיפושים האחרונים">
          <p className="max-w-md leading-relaxed text-muted">נסו שוב בעוד רגע.</p>
          <div className="flex flex-wrap justify-center gap-3">
            {/* A full reload, so the list is really read again. */}
            <a href={recentHref(filter)} className={`${btnPrimary} ${btnMd}`}>
              <RotateCcw aria-hidden className="size-[18px]" />
              ניסיון נוסף
            </a>
            <Link href="/" className={`${btnSecondary} ${btnMd}`}>
              לדף הבית
            </Link>
          </div>
        </StateCard>
      ) : list.items.length === 0 && list.categories.length === 0 ? (
        <NothingYet />
      ) : (
        <Listing list={list} filter={filter} now={now} />
      )}
    </div>
  );
}

function Listing({
  list,
  filter,
  now,
}: {
  list: RecentSearchList;
  filter: RecentSearchFilter;
  now: Date;
}) {
  const { items } = list;
  const filtered = Boolean(filter.category || filter.text);
  const showMore = items.length > 0 && list.hasMore && filter.page < RECENT_MAX_PAGES;
  // An id without a Hebrew name is listed under "אחר", so that pill is the active one.
  const category = toRecentQuery(filter).category ?? undefined;
  return (
    <div className="space-y-6">
      <RecentSearchesFilters categories={list.categories} category={category} text={filter.text} />
      <p role="status" className="sr-only">
        {items.length === 0
          ? "לא נמצאו חיפושים"
          : items.length === 1
            ? "מוצג חיפוש אחד"
            : `מוצגים ${items.length} חיפושים`}
      </p>
      {items.length === 0 ? (
        // Unfiltered and still empty: every row was dropped by the checks at read time.
        filtered ? (
          <StateCard Icon={SearchX} title="לא מצאנו חיפושים שמתאימים לסינון">
            <p className="max-w-md leading-relaxed text-muted">נסו מילה אחרת או קטגוריה אחרת.</p>
            <Link href={recentHref({})} className={`${btnSecondary} ${btnMd}`}>
              ניקוי הסינון
            </Link>
          </StateCard>
        ) : (
          <NothingYet />
        )
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((search, i) => (
            // Focusable from script only (FocusHashTarget), for "הצגת עוד חיפושים".
            <li
              key={search.queryNorm}
              id={`${CARD_ID}${i}`}
              tabIndex={-1}
              className="min-w-0 scroll-mt-6 rounded-card"
            >
              <RecentSearchCard search={search} now={now} />
            </li>
          ))}
        </ul>
      )}
      {showMore && (
        <div className="flex justify-center">
          {/* Page n lists the first n pages. The link goes to the first new card: Next scrolls
              it into view and FocusHashTarget moves focus there, since this link may be gone. */}
          <Link
            href={`${recentHref({ ...filter, page: filter.page + 1 })}#${CARD_ID}${items.length}`}
            className={`${btnSecondary} ${btnMd}`}
          >
            הצגת עוד חיפושים
            <ChevronDown aria-hidden className="size-[18px]" />
          </Link>
        </div>
      )}
      <FocusHashTarget page={filter.page} prefix={CARD_ID} />
    </div>
  );
}
