// What both routes of a category page share: the slug lookup and the metadata. The default view
// is cached (app/products-view/[slug]/page.tsx), a filtered one rendered per request (./page.tsx).
import type { Metadata } from "next";
import {
  catalogBySlug,
  categoryPath,
  categoryTitle,
  type CatalogCategory,
} from "@/lib/catalog/categories";
import { FILTERS } from "@/lib/ranking/config";
import { pageMetadata } from "@/lib/seo/page-meta";
import { parseSlugParam } from "@/lib/seo/slug";

/** The catalog category of the route's slug (percent-encoded or decoded), or null. */
export function categoryOf(slugParam: string): CatalogCategory | null {
  const slug = parseSlugParam(slugParam);
  return slug ? catalogBySlug(slug) : null;
}

// Indexable; the canonical is the category's page alone: the sub-category, price, sort, toggles,
// step and lists loaded are views of it.
export function categoryMetadata(slugParam: string): Metadata {
  const category = categoryOf(slugParam);
  if (!category) return { title: "הדף לא נמצא", robots: { index: false } };
  return pageMetadata({
    title: categoryTitle(category),
    description: `${category.introHe} רק מוצרים עם לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים.`,
    path: categoryPath(category),
  });
}
