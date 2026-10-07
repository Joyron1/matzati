import type { Metadata } from "next";
import { PRODUCTS_PATH, parseHotParams } from "@/lib/hot/params";
import { FILTERS } from "@/lib/ranking/config";
import { pageMetadata } from "@/lib/seo/page-meta";
import { ProductsHubView, TITLE } from "./hub-view";

// Indexable; the canonical is /products alone: the price, sort, toggles and step are views of it.
export function generateMetadata(): Metadata {
  return pageMetadata({
    title: `${TITLE}: מוצרים מאלי אקספרס שעברו סינון`,
    description: `מוצרים חמים מאלי אקספרס לפי קטגוריה: אלקטרוניקה, בית ומטבח, תכשיטים, צעצועים ועוד, רק כאלה עם לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים.`,
    path: PRODUCTS_PATH,
  });
}

/**
 * A filtered view of "כל המוצרים" (price, sort, toggles, step), per request. The default view is
 * served cached from app/products-view/page.tsx (the rewrite in next.config.ts).
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A category is not read here (hotHref leaves it out): /products/<slug> is a category's page.
  return <ProductsHubView filter={parseHotParams(await searchParams)} />;
}
