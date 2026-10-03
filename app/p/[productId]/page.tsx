import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SimilarProducts } from "@/components/similar-products";
import { BRAND } from "@/lib/config/brand";
import { hotBack as hotBackOf } from "@/lib/hot/params";
import { clip } from "@/lib/og/bidi";
import { productTitleView } from "@/lib/product-title";
import { firstParam, parseSort, parseWithout } from "@/lib/search-url";
import { productForPage } from "@/lib/search/server";
import { pageMetadata } from "@/lib/seo/page-meta";
import { similarForPage, type SimilarRequest } from "@/lib/similar/load";
import { ProductView } from "./product-view";

// A fresh search (parse, up to 3 AliExpress calls, explain) takes 7-15 s; give it room.
export const maxDuration = 60;

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

/**
 * The similar products, streamed after the rest of the page: reads of what is already cached only
 * (lib/similar/load.ts), and nothing at all when there is nothing to show.
 */
async function SimilarSection({ request }: { request: SimilarRequest }) {
  const data = await similarForPage(request);
  return <SimilarProducts data={data} className="mt-12" />;
}

export default async function ProductPage({ params, searchParams }: PageProps<"/p/[productId]">) {
  const { productId } = await params;
  const query = await searchParams;
  const q = firstParam(query.q).trim().slice(0, 200);
  // Opened from a hot list (from=hot&cat=<catalog key>, also the old /hot links): back to it.
  const hotBack = hotBackOf(query);
  const data = await productForPage(productId);
  if (!data) notFound();

  const request: SimilarRequest = {
    productId: data.product.product_id,
    categoryId: data.product.category_id,
    q,
    sort: parseSort(query.sort),
    without: parseWithout(query.without),
    hot: hotBack ? { category: hotBack.category } : null,
  };
  return (
    <ProductView
      data={data}
      q={q}
      hotBack={hotBack}
      now={new Date()}
      similar={
        <Suspense fallback={null}>
          <SimilarSection request={request} />
        </Suspense>
      }
    />
  );
}
