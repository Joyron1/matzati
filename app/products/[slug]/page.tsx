import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  catalogBySlug,
  categoryPath,
  categoryTitle,
  type CatalogCategory,
} from "@/lib/catalog/categories";
import { loadCategoryList } from "@/lib/catalog/load";
import { parseCategoryParams } from "@/lib/catalog/params";
import { siteUrl } from "@/lib/config/site";
import { isBotUserAgent } from "@/lib/guard/bots";
import { FILTERS } from "@/lib/ranking/config";
import { pageMetadata } from "@/lib/seo/page-meta";
import { parseSlugParam } from "@/lib/seo/slug";
import { CategoryView } from "./category-view";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The catalog category of the route's slug (percent-encoded or decoded), or null. */
function categoryOf(slugParam: string): CatalogCategory | null {
  const slug = parseSlugParam(slugParam);
  return slug ? catalogBySlug(slug) : null;
}

// Indexable; the canonical is the category's page alone: the sub-category, price, sort, toggles,
// step and lists loaded are views of it.
export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const category = categoryOf((await params).slug);
  if (!category) return { title: "הדף לא נמצא", robots: { index: false } };
  return pageMetadata({
    title: categoryTitle(category),
    description: `${category.introHe} רק מוצרים עם לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים.`,
    path: categoryPath(category),
  });
}

/**
 * A category of "כל המוצרים" (owner request 2026-10-03): its hot list (page 1 of
 * hotproduct.query; pages 2 and 3 only after a visitor's "הצגת עוד מוצרים", each cached 12 hours
 * like page 1), sub-category pills and /hot's filters over what is loaded (never a call), a search
 * limited to the category, and the notes /hot had. A crawler gets page 1 like anyone and pages 2-3
 * only from the cache (never a call). Only slugs of the fixed catalog render; any other is a 404
 * without a call.
 */
export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const category = categoryOf((await params).slug);
  if (!category) notFound();
  const filter = parseCategoryParams(category, await searchParams);
  const bot = isBotUserAgent((await headers()).get("user-agent"));
  const result = await loadCategoryList(category, filter.lists, { readOnlyMore: bot });
  return (
    <CategoryView
      category={category}
      filter={filter}
      result={result}
      now={new Date()}
      origin={siteUrl()}
    />
  );
}
