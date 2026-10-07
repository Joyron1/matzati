// The default view (no filter) of "כל המוצרים", cached (owner request 2026-10-08, Vercel CPU).
// Never linked: next.config.ts rewrites /products without a view parameter here. A filtered view
// keeps rendering per request (app/products/page.tsx).
import type { Metadata } from "next";
import { ProductsHubView } from "@/app/products/hub-view";
import { generateMetadata as productsMetadata } from "@/app/products/page";
import { parseHotParams } from "@/lib/hot/params";

// As long as the hot lists it shows (HOT_LIST_TTL_MS, 12 hours).
export const revalidate = 43200;

export function generateMetadata(): Metadata {
  return productsMetadata();
}

export default function ProductsDefaultView() {
  return <ProductsHubView filter={parseHotParams({})} />;
}
