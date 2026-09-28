import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, CloudOff, PackageSearch, RotateCcw, SearchX } from "lucide-react";
import { FocusHashTarget } from "@/components/focus-hash-target";
import { HotProductCard } from "@/components/hot-product-card";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary, card } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { absoluteUrl } from "@/lib/config/site";
import { formatCount, formatDateTime } from "@/lib/format";
import { hotCategoryLabel, type HotCategoryId } from "@/lib/hot/categories";
import { HOT_FILTER_NOTE, HOT_TITLES_NOTE } from "@/lib/hot/copy";
import type { HotPoolFailure } from "@/lib/hot/loader";
import {
  HOT_MAX_PAGES,
  HOT_PAGE_SIZE,
  hotCanonicalPath,
  hotHref,
  hotProductHref,
  parseHotParams,
  type HotFilter,
} from "@/lib/hot/params";
import { loadHotMix, loadHotPool } from "@/lib/hot/queries";
import { mixHotProducts, viewHotProducts, type HotProduct } from "@/lib/hot/select";
import { FILTERS } from "@/lib/ranking/config";
import { HotFilters } from "./hot-filters";

const TITLE = "מוצרים חמים";

function describe(label: string | null): string {
  const where = label ? `באלי אקספרס בקטגוריה ${label}` : "של אלי אקספרס לפי קטגוריה";
  return `המוצרים החמים ${where}, רק כאלה עם לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים. אפשר לסנן לפי מחיר, קוד הנחה וסרטון.`;
}

// Indexable. Only /hot and /hot?cat=<id> are canonical: the price, sort, toggles and page are
// views of the same list.
export async function generateMetadata({ searchParams }: PageProps<"/hot">): Promise<Metadata> {
  const { category } = parseHotParams(await searchParams);
  const label = category ? hotCategoryLabel(category) : null;
  const title = label ? `${TITLE}: ${label}` : TITLE;
  const url = absoluteUrl(hotCanonicalPath(category));
  return {
    title,
    description: describe(label),
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      locale: "he_IL",
      siteName: BRAND.name,
      url,
      title: `${title} | ${BRAND.name}`,
      description: describe(label),
    },
  };
}

/** Id prefix of the grid items; "הצגת עוד מוצרים" links to the first new one. */
const CARD_ID = "hot-";

/** What the grid shows, with the lines above it that say where it comes from. */
interface HotList {
  products: HotProduct[];
  /** One short line: what was checked, or which categories are mixed. */
  summary: ReactNode;
  /** The muted line under it: our thresholds and when the prices were checked. */
  details: string;
}

type ListResult = { ok: true; list: HotList } | { ok: false; reason: HotPoolFailure };

const count = (n: number) => <bdi dir="ltr">{formatCount(n)}</bdi>;

/** One category's list, or without a category the mix (MIX_CATEGORY_IDS). */
async function loadList(category?: HotCategoryId): Promise<ListResult> {
  if (category) {
    const res = await loadHotPool(category);
    if (!res.ok) return res;
    const { checked, products, fetchedAt } = res.pool;
    return {
      ok: true,
      list: {
        products,
        summary: (
          <>
            בדקנו {count(checked)} מוצרים מהרשימה של אלי אקספרס.{" "}
            {products.length === 1 ? "מוצר אחד עבר" : <>{count(products.length)} עברו</>} את הסינון.
          </>
        ),
        details: `${HOT_FILTER_NOTE} הרשימה והמחירים נבדקו ב־${formatDateTime(fetchedAt)}.`,
      },
    };
  }
  const mix = await loadHotMix();
  if (!mix.ok) return mix;
  // ISO times in one zone sort as text. Every price shown was checked at the oldest time or later.
  const [oldest] = mix.pools.map((pool) => pool.fetchedAt).sort();
  const labels = mix.pools.flatMap((pool) => hotCategoryLabel(pool.key) ?? []);
  return {
    ok: true,
    list: {
      products: mixHotProducts(mix.pools.map((pool) => pool.products)),
      summary:
        labels.length === 1 ? (
          <>מבחר מהנמכרים בקטגוריה אחת</>
        ) : (
          <>מבחר מהנמכרים ב־{count(labels.length)} קטגוריות</>
        ),
      details: `${labels.join(", ")}. ${HOT_FILTER_NOTE} בדקנו את הרשימות והמחירים החל מ־${formatDateTime(oldest)}.`,
    },
  };
}

export default async function HotPage({ searchParams }: PageProps<"/hot">) {
  const filter = parseHotParams(await searchParams);
  const label = filter.category ? hotCategoryLabel(filter.category) : null;
  // Reading search params makes this a per-request page: nothing here runs at build time.
  const result = await loadList(filter.category);
  const now = new Date();

  return (
    // Tighter on phones, so the first row of products shows on the first screen.
    <div className="mx-auto max-w-6xl space-y-5 px-4 pt-6 sm:space-y-8 sm:px-6 sm:pt-12">
      <div className="max-w-2xl space-y-3">
        <h1 className="font-display text-4xl sm:text-5xl">
          {TITLE}
          {label && (
            <>
              <span className="sr-only">: </span>
              <span className="mt-2 block text-2xl text-accent-ink sm:text-3xl">{label}</span>
            </>
          )}
        </h1>
        {/* The thresholds are stated over the grid (Listing) and in "מאיפה הרשימה". */}
        <p className="text-lg leading-relaxed text-muted">
          הנמכרים באלי אקספרס, אחרי הסינון שלנו. בחרו קטגוריה, טווח מחירים או מיון.
        </p>
      </div>

      <HotFilters filter={filter} />

      {result.ok ? (
        <Listing list={result.list} filter={filter} now={now} />
      ) : result.reason === "empty" ? (
        <NothingHot category={filter.category} />
      ) : (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את המוצרים החמים">
          <p className="max-w-md leading-relaxed text-muted">
            לא הצלחנו לקבל כרגע את הרשימה מאלי אקספרס. נסו שוב בעוד כמה דקות, או חפשו מוצר בעצמכם.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {/* A full reload, so the list is really asked for again. */}
            <a href={hotHref(filter)} className={`${btnPrimary} ${btnMd}`}>
              <RotateCcw aria-hidden className="size-[18px]" />
              ניסיון נוסף
            </a>
            <Link href="/" className={`${btnSecondary} ${btnMd}`}>
              לחיפוש מוצר
            </Link>
          </div>
        </StateCard>
      )}

      <AboutTheList />
    </div>
  );
}

function NothingHot({ category }: { category?: HotCategoryId }) {
  return (
    <StateCard Icon={PackageSearch} title="אין כרגע מוצרים חמים שעברו את הסינון">
      <p className="max-w-md leading-relaxed text-muted">
        {category
          ? "נסו קטגוריה אחרת, או חפשו מוצר בעצמכם."
          : "נסו שוב מאוחר יותר, או חפשו מוצר בעצמכם."}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {category && (
          <Link href={hotHref({})} className={`${btnPrimary} ${btnMd}`}>
            למבחר המוצרים החמים
          </Link>
        )}
        <Link href="/" className={`${btnSecondary} ${btnMd}`}>
          לחיפוש מוצר
        </Link>
      </div>
    </StateCard>
  );
}

function Listing({ list, filter, now }: { list: HotList; filter: HotFilter; now: Date }) {
  const matching = viewHotProducts(list.products, filter, now);
  const shown = matching.slice(0, filter.page * HOT_PAGE_SIZE);
  const showMore = shown.length < matching.length && filter.page < HOT_MAX_PAGES;
  return (
    <section aria-labelledby="hot-list-title" className="space-y-5">
      <div className="space-y-1">
        <h2 id="hot-list-title" className="sr-only">
          המוצרים
        </h2>
        <p className="font-semibold text-ink">{list.summary}</p>
        <p className="text-sm leading-relaxed text-muted">{list.details}</p>
      </div>
      <p role="status" className="sr-only">
        {matching.length === 0
          ? "לא נמצאו מוצרים"
          : `מוצגים ${shown.length} מתוך ${matching.length} מוצרים`}
      </p>
      {matching.length === 0 ? (
        <StateCard Icon={SearchX} title="לא מצאנו מוצרים שמתאימים לסינון">
          {/* A list is never empty, so only a filter can leave nothing to show. */}
          <p className="max-w-md leading-relaxed text-muted">
            נסו טווח מחירים אחר, או הסירו את הסינון.
          </p>
          <Link
            href={hotHref({ category: filter.category, sort: filter.sort })}
            className={`${btnSecondary} ${btnMd}`}
          >
            ניקוי הסינון
          </Link>
        </StateCard>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {shown.map((product, i) => (
            // Focusable from script only (FocusHashTarget), for "הצגת עוד מוצרים".
            <li
              key={product.productId}
              id={`${CARD_ID}${i}`}
              tabIndex={-1}
              className="min-w-0 scroll-mt-6 rounded-card"
            >
              <HotProductCard
                product={product}
                now={now}
                sizes="(min-width: 1024px) 270px, (min-width: 640px) 30vw, 46vw"
                preload={i < 2}
                href={hotProductHref(product.productId, filter.category)}
              />
            </li>
          ))}
        </ul>
      )}
      {showMore && (
        <div className="flex justify-center">
          {/* Page n lists the first n pages. The link goes to the first new card: Next scrolls
              it into view and FocusHashTarget moves focus there, since this link may be gone. */}
          <Link
            href={`${hotHref({ ...filter, page: filter.page + 1 })}#${CARD_ID}${shown.length}`}
            className={`${btnSecondary} ${btnMd}`}
          >
            הצגת עוד מוצרים
            <ChevronDown aria-hidden className="size-[18px]" />
          </Link>
        </div>
      )}
      <FocusHashTarget page={filter.page} prefix={CARD_ID} />
    </section>
  );
}

/** Where the lists come from and what the numbers mean. Shown in every state. */
function AboutTheList() {
  return (
    <section aria-labelledby="hot-about-title" className={`${card} space-y-3 p-6 sm:p-7`}>
      <h2 id="hot-about-title" className="font-display text-2xl">
        מאיפה הרשימה
      </h2>
      <ul className="max-w-3xl list-disc space-y-2 ps-5 leading-relaxed text-muted marker:text-muted">
        <li>
          זו רשימת המוצרים החמים שאלי אקספרס מציעה לשותפים שלה, לפי קטגוריה. אנחנו מציגים ממנה רק את
          מה שעבר את הסינון שלנו, וכברירת מחדל ממיינים לפי מספר המכירות ב־30 הימים האחרונים.
        </li>
        <li>{HOT_FILTER_NOTE} כל המספרים מאלי אקספרס.</li>
        <li>
          המחירים הם מה שאלי אקספרס הציגה כשבדקנו את הרשימה, והם יכולים להשתנות. המחיר הסופי מוצג
          באלי אקספרס.
        </li>
        <li>{HOT_TITLES_NOTE}</li>
        <li>
          על מוצרים מהרשימה הזו אלי אקספרס עשויה לשלם לנו עמלה גבוהה יותר. העמלה לא משפיעה על הסינון
          ועל הסדר.
        </li>
      </ul>
      <Link
        href="/terms#affiliate"
        className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        לגילוי הנאות המלא
      </Link>
    </section>
  );
}
