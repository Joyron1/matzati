import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CatalogIcon } from "@/components/catalog-icon";
import { ProductImage } from "@/components/product-image";
import { card } from "@/components/styles";
import { CATALOG, categoryPath } from "@/lib/catalog/categories";
import { cachedCategoryPhoto } from "@/lib/catalog/load";
import { siteUrl } from "@/lib/config/site";
import { formatDateTime } from "@/lib/format";
import { hotCategoryLabel } from "@/lib/hot/categories";
import { HOT_FILTER_NOTE } from "@/lib/hot/copy";
import type { HotPool } from "@/lib/hot/loader";
import {
  HOT_MAX_PAGES,
  HOT_PAGE_SIZE,
  PRODUCTS_PATH,
  hotHref,
  hotProductHref,
  parseHotParams,
  type HotFilter,
} from "@/lib/hot/params";
import { loadHotMix } from "@/lib/hot/queries";
import { mixHotProducts, viewHotProducts } from "@/lib/hot/select";
import { FILTERS } from "@/lib/ranking/config";
import { pageMetadata } from "@/lib/seo/page-meta";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/structured-data";
import { HotFilters } from "./hot-filters";
import { AboutTheList, count, ListFailed, Listing, NothingPassed } from "./hot-listing";

const TITLE = "כל המוצרים";

// Indexable; the canonical is /products alone: the price, sort, toggles and step are views of it.
export function generateMetadata(): Metadata {
  return pageMetadata({
    title: `${TITLE}: מוצרים מאלי אקספרס שעברו סינון`,
    description: `מוצרים חמים מאלי אקספרס לפי קטגוריה: אלקטרוניקה, בית ומטבח, תכשיטים, צעצועים ועוד, רק כאלה עם לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים.`,
    path: PRODUCTS_PATH,
  });
}

/**
 * "כל המוצרים" (owner request 2026-10-03, replaces /hot): a tile per catalog category, then the
 * mixed hot list ("מבחר", MIX_CATEGORY_IDS) with /hot's filters. A tile's photo comes only from a
 * list this instance already holds (cachedCategoryPhoto): the hub never fetches a category's list
 * for a tile. The mix loads as /hot's did (cold: one list call and one hot links call per mixed
 * category, spaced).
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A category is not read here (hotHref leaves it out): /products/<slug> is a category's page.
  const filter = parseHotParams(await searchParams);
  // Reading search params makes this a per-request page: nothing here runs at build time.
  const mix = await loadHotMix();
  const now = new Date();
  const origin = siteUrl();

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pt-6 sm:space-y-8 sm:px-6 sm:pt-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "בית", url: `${origin}/` },
              { name: TITLE, url: `${origin}${PRODUCTS_PATH}` },
            ]),
          ),
        }}
      />
      <div className="space-y-2">
        <Breadcrumbs items={[{ label: "בית", href: "/" }, { label: TITLE }]} />
        <div className="max-w-2xl space-y-3">
          <h1 className="font-display text-4xl sm:text-5xl">{TITLE}</h1>
          <p className="text-lg leading-relaxed text-muted">
            המוצרים החמים של אלי אקספרס לפי קטגוריה, אחרי הסינון שלנו. בחרו קטגוריה, או גללו למבחר
            מכמה קטגוריות.
          </p>
        </div>
      </div>

      <CategoryTiles />

      <section aria-labelledby="mix-title" className="space-y-5 sm:space-y-6">
        <h2 id="mix-title" className="font-display text-3xl">
          מבחר
        </h2>
        <HotFilters
          view={filter}
          action={PRODUCTS_PATH}
          fieldsKey={hotHref({ ...filter, page: undefined })}
          clearHref={hotHref({ sort: filter.sort })}
        />
        {mix.ok ? (
          <MixListing pools={mix.pools} filter={filter} now={now} />
        ) : mix.reason === "empty" ? (
          <NothingPassed />
        ) : (
          <ListFailed retryHref={hotHref(filter)} />
        )}
      </section>

      <AboutTheList />
    </div>
  );
}

/** A tile per category: icon, name and, when a list is already at hand, one of its photos. */
function CategoryTiles() {
  return (
    <nav aria-labelledby="categories-title">
      <h2 id="categories-title" className="sr-only">
        קטגוריות
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
        {CATALOG.map((c) => {
          const photo = cachedCategoryPhoto(c);
          return (
            <li key={c.key} className="min-w-0">
              <Link
                href={categoryPath(c)}
                className={`${card} group flex h-full items-center gap-3 p-3 hover:border-muted hover:shadow-soft sm:p-4`}
              >
                {photo ? (
                  <ProductImage
                    src={photo}
                    alt=""
                    className="size-12 shrink-0 overflow-hidden rounded-xl"
                    iconClassName="size-6"
                    sizes="48px"
                  />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                    <CatalogIcon name={c.icon} className="size-6" />
                  </span>
                )}
                <span className="min-w-0 text-[15px] leading-snug font-semibold text-ink group-hover:text-accent-ink">
                  {c.nameHe}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function MixListing({ pools, filter, now }: { pools: HotPool[]; filter: HotFilter; now: Date }) {
  // ISO times in one zone sort as text. Every price shown was checked at the oldest time or later.
  const [oldest] = pools.map((pool) => pool.fetchedAt).sort();
  const labels = pools.flatMap((pool) => hotCategoryLabel(pool.key) ?? []);
  const matching = viewHotProducts(mixHotProducts(pools.map((pool) => pool.products)), filter, now);
  const shown = matching.slice(0, filter.page * HOT_PAGE_SIZE);
  const more = shown.length < matching.length && filter.page < HOT_MAX_PAGES;
  return (
    <Listing
      summary={
        labels.length === 1 ? (
          <>מבחר מהנמכרים בקטגוריה אחת</>
        ) : (
          <>מבחר מהנמכרים ב־{count(labels.length)} קטגוריות</>
        )
      }
      details={`${labels.join(", ")}. ${HOT_FILTER_NOTE} בדקנו את הרשימות והמחירים החל מ־${formatDateTime(oldest)}.`}
      matching={matching.length}
      shown={shown}
      step={filter.page}
      moreHref={
        more ? `${hotHref({ ...filter, page: filter.page + 1 })}#hot-${shown.length}` : null
      }
      clearHref={hotHref({ sort: filter.sort })}
      // The mix has no category of its own: /p goes back to /products.
      productHref={(id) => hotProductHref(id)}
      now={now}
    />
  );
}
