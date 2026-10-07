import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BRAND } from "@/lib/config/brand";
import { CATALOG } from "@/lib/catalog/categories";
import { hotBack } from "@/lib/hot/params";
import { clip } from "@/lib/og/bidi";
import { productTitleView } from "@/lib/product-title";
import { productForPage } from "@/lib/search/server";
import { pageMetadata } from "@/lib/seo/page-meta";
import { BackLink, DefaultBackLink, SimilarFromVisit, type HotBacks } from "./from-visit";
import { ProductView } from "./product-view";

// A refresh (productdetail.get, link.generate) can take a few seconds; give it room.
export const maxDuration = 60;

// Cached a day per product (owner request 2026-10-08: crawlers going through thousands of product
// pages rendered each one on every visit, most of the project's Vercel CPU). The first visit of a
// day renders it, refreshing the product from AliExpress when its row is over a day old
// (productForPage); every other visit, crawler or not, gets the cached page. Nothing here reads
// the request: the back link and the similar products depend on where the visitor came from, so
// they read the address in the browser (./from-visit.tsx).
export const revalidate = 86400;

/** No product is built at build time: each page is made on its first visit. */
export function generateStaticParams() {
  return [];
}

/** The hot lists' back links by catalog key ("" for the mix), for BackLink in the browser. */
const HOT_BACKS: HotBacks = Object.fromEntries([
  ["", pick(hotBack({ from: "hot" }))],
  ...CATALOG.map((c) => [c.key, pick(hotBack({ from: "hot", cat: c.key }))]),
]);

function pick(back: ReturnType<typeof hotBack>) {
  return { href: back?.href ?? "/products", label: back?.label ?? "חזרה לכל המוצרים" };
}

// productForPage is request-cached, so the metadata and the page share one lookup.
export async function generateMetadata({ params }: PageProps<"/p/[productId]">): Promise<Metadata> {
  const data = await productForPage((await params).productId);
  // The heading's text: a hot product's machine-translated title with known loan words fixed.
  const title = data && productTitleView(data.product.title_he, data.product.title_en).text;
  if (!title) return { title: "מוצר לא נמצא" };
  return pageMetadata({
    title,
    description: `מחיר, משוב של קונים ומספר מכירות באלי אקספרס, ב${BRAND.name}: ${clip(title, 110)}`,
    path: `/p/${data.product.product_id}`,
    ownImage: true,
  });
}

export default async function ProductPage({ params }: PageProps<"/p/[productId]">) {
  const { productId } = await params;
  const data = await productForPage(productId);
  if (!data) notFound();
  return (
    <ProductView
      data={data}
      q=""
      now={new Date()}
      backSlot={
        <Suspense fallback={<DefaultBackLink />}>
          <BackLink hotBacks={HOT_BACKS} />
        </Suspense>
      }
      similar={
        <Suspense fallback={null}>
          <SimilarFromVisit
            productId={data.product.product_id}
            categoryId={data.product.category_id}
          />
        </Suspense>
      }
    />
  );
}
