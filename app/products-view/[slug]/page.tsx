// The default view (no filter) of a "כל המוצרים" category page, cached (owner request 2026-10-08:
// rendered per request, crawlers included, it cost Vercel CPU). Never linked: next.config.ts
// rewrites /products/<slug> without a view parameter here, so the address stays the category's.
// A filtered view keeps rendering per request (app/products/[slug]/page.tsx).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryView } from "@/app/products/[slug]/category-view";
import { categoryMetadata, categoryOf } from "@/app/products/[slug]/meta";
import { shortLived } from "@/lib/cache-lifetime";
import { loadCategoryList } from "@/lib/catalog/load";
import { parseCategoryParams } from "@/lib/catalog/params";
import { siteUrl } from "@/lib/config/site";

// As long as the hot list it shows (HOT_LIST_TTL_MS, 12 hours).
export const revalidate = 43200;

/** None at build time: a category is made on its first visit (a build never calls AliExpress). */
export function generateStaticParams() {
  return [];
}

interface DefaultViewProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: DefaultViewProps): Promise<Metadata> {
  return categoryMetadata((await params).slug);
}

export default async function CategoryDefaultView({ params }: DefaultViewProps) {
  const category = categoryOf((await params).slug);
  if (!category) notFound();
  const filter = parseCategoryParams(category, {});
  // Page 1 of the list only: a crawler and a visitor get the same thing.
  const result = await loadCategoryList(category, filter.lists, { readOnlyMore: true });
  // Cached 12 hours: a failed list must not stay that long.
  if (!result.ok) await shortLived();
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
