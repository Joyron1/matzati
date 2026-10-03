// The category page's view, from its loaded list: rendered by ./page.tsx and, with made-up data, by
// the dev preview (/dev/preview/products-category). Reads nothing itself.
import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { StateCard } from "@/components/state-card";
import { btnMd, btnSecondary } from "@/components/styles";
import { catalogByFirstLevel, categoryPath, type CatalogCategory } from "@/lib/catalog/categories";
import type { CategoryListResult } from "@/lib/catalog/load";
import { inSubcategory, subcategoryPills, type CategoryProducts } from "@/lib/catalog/list";
import {
  CATEGORY_PAGE_SIZE,
  categoryHref,
  nextCategoryStep,
  type CategoryFilter,
} from "@/lib/catalog/params";
import { formatDateTime } from "@/lib/format";
import { HOT_FILTER_NOTE } from "@/lib/hot/copy";
import { PRODUCTS_PATH, hotProductHref } from "@/lib/hot/params";
import { viewHotProducts } from "@/lib/hot/select";
import { hotTitle } from "@/lib/product-title";
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from "@/lib/seo/structured-data";
import { HotFilters, type FilterPill } from "../hot-filters";
import {
  AboutTheList,
  CARD_ID,
  checkedSummary,
  ListFailed,
  Listing,
  NothingPassed,
} from "../hot-listing";
import { CategorySearch } from "./category-search";

/**
 * The page of `category` for `filter` with what loadCategoryList returned. `origin` is SITE_URL
 * (JSON-LD); `now` the render time (promo codes valid now).
 */
export function CategoryView({
  category,
  filter,
  result,
  now,
  origin,
}: {
  category: CatalogCategory;
  filter: CategoryFilter;
  result: CategoryListResult;
  now: Date;
  origin: string;
}) {
  const pageUrl = `${origin}${categoryPath(category)}`;
  // A slice (Home Decor) searches its first-level category: the only id a search may name.
  const searchIn = category.slice ? catalogByFirstLevel(category.firstLevelId) : category;

  const view = result.ok ? productsView(category, result.list, filter, now, result.complete) : null;
  const crumbs = [
    { name: "בית", url: `${origin}/` },
    { name: "כל המוצרים", url: `${origin}${PRODUCTS_PATH}` },
    { name: category.nameHe, url: pageUrl },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pt-6 sm:space-y-8 sm:px-6 sm:pt-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }}
      />
      {view && view.shown.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              itemListJsonLd({
                origin,
                pageUrl,
                name: category.nameHe,
                products: view.shown.map((p) => ({
                  product_id: p.productId,
                  title_he: hotTitle(p.title),
                  image_urls: p.imageUrl ? [p.imageUrl] : [],
                })),
              }),
            ),
          }}
        />
      )}

      <div className="space-y-2">
        <Breadcrumbs
          items={[
            { label: "בית", href: "/" },
            { label: "כל המוצרים", href: PRODUCTS_PATH },
            { label: category.nameHe },
          ]}
        />
        <div className="max-w-2xl space-y-3">
          <h1 className="font-display text-4xl sm:text-5xl">{category.nameHe}</h1>
          <p className="text-lg leading-relaxed text-muted">
            {category.introHe} מוצגים רק מוצרים שעברו את הסינון שלנו.
          </p>
        </div>
      </div>

      {searchIn && <CategorySearch category={searchIn} />}

      <HotFilters
        view={filter}
        action={categoryPath(category)}
        hidden={{
          ...(filter.sub ? { sub: filter.sub } : {}),
          // What a visitor loaded stays loaded: a filter never costs a call.
          ...(filter.lists > 1 ? { lists: String(filter.lists) } : {}),
        }}
        fieldsKey={categoryHref(category, { ...filter, page: undefined })}
        clearHref={categoryHref(category, {
          sub: filter.sub,
          sort: filter.sort,
          lists: filter.lists,
        })}
        pills={view?.pills ?? []}
      />

      {!result.ok ? (
        result.reason === "empty" ? (
          <NothingPassed otherHref={PRODUCTS_PATH} otherLabel="לכל הקטגוריות" />
        ) : (
          <ListFailed retryHref={categoryHref(category, filter)} />
        )
      ) : (
        view && (
          <Listing
            summary={checkedSummary(result.list.checked, result.list.products.length)}
            details={`${HOT_FILTER_NOTE} הרשימה והמחירים נבדקו ${
              result.loaded > 1 ? "החל מ־" : "ב־"
            }${formatDateTime(result.list.checkedFrom)}.`}
            matching={view.matching.length}
            shown={view.shown}
            step={filter.page}
            moreHref={
              view.next
                ? `${categoryHref(category, view.next)}#${CARD_ID}${view.shown.length}`
                : null
            }
            clearHref={categoryHref(category, { lists: filter.lists })}
            productHref={(id) => hotProductHref(id, category.key)}
            now={now}
            empty={
              // Nothing of a slice (or a sub-category) on the pages loaded yet, with no filter
              // on: offer the next page of the list rather than "clear the filter".
              view.matching.length === 0 &&
              !filter.price &&
              !filter.withCode &&
              !filter.withVideo &&
              view.next ? (
                <StateCard Icon={PackageSearch} title="עוד לא מצאנו כאן מוצרים">
                  <p className="max-w-md leading-relaxed text-muted">
                    בחלק הראשון של הרשימה של אלי אקספרס אין מוצרים מהקטגוריה הזו שעברו את הסינון.
                    אפשר לבדוק את ההמשך שלה.
                  </p>
                  <Link
                    href={categoryHref(category, view.next)}
                    className={`${btnSecondary} ${btnMd}`}
                  >
                    הצגת עוד מוצרים
                  </Link>
                </StateCard>
              ) : undefined
            }
          />
        )
      )}

      <AboutTheList />
    </div>
  );
}

/** What the grid shows for `filter`, the sub-category pills and the next "more" step. */
function productsView(
  category: CatalogCategory,
  list: CategoryProducts,
  filter: CategoryFilter,
  now: Date,
  complete: boolean,
) {
  const inSub = inSubcategory(category.firstLevelId, list.products, filter.sub);
  const matching = viewHotProducts(inSub, filter, now);
  const shown = matching.slice(0, filter.page * CATEGORY_PAGE_SIZE);
  const groups = subcategoryPills(category, list.products);
  const pills: FilterPill[] = groups.length
    ? [
        {
          key: "all",
          label: "הכול",
          href: categoryHref(category, { ...filter, sub: undefined, page: undefined }),
          current: filter.sub === undefined,
        },
        ...groups.map((g) => ({
          key: g.id,
          label: g.labelHe,
          href: categoryHref(category, { ...filter, sub: g.id, page: undefined }),
          current: filter.sub === g.id,
        })),
      ]
    : [];
  const next = nextCategoryStep(filter, shown.length, matching.length, complete);
  return { matching, shown, pills, next };
}
