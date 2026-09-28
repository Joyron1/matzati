import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SimilarProducts } from "@/components/similar-products";
import { hotBackHref, parseHotParams } from "@/lib/hot/params";
import { productTitleView } from "@/lib/product-title";
import { firstParam, parseSort, parseWithout } from "@/lib/search-url";
import { productForPage } from "@/lib/search/server";
import { similarForPage, type SimilarRequest } from "@/lib/similar/load";
import { ProductView } from "./product-view";

// A fresh search (parse, up to 3 AliExpress calls, explain) takes 7-15 s; give it room.
export const maxDuration = 60;

// productForPage is request-cached, so the metadata and the page share one lookup.
export async function generateMetadata({ params }: PageProps<"/p/[productId]">): Promise<Metadata> {
  const data = await productForPage((await params).productId);
  // The heading's text: a hot product's machine-translated title with known loan words fixed.
  const title = data && productTitleView(data.product.title_he, data.product.title_en).text;
  return { title: title ?? "מוצר לא נמצא" };
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
  const hotBack = hotBackHref(query);
  const data = await productForPage(productId);
  if (!data) notFound();

  const request: SimilarRequest = {
    productId: data.product.product_id,
    categoryId: data.product.category_id,
    q,
    sort: parseSort(query.sort),
    without: parseWithout(query.without),
    hot: hotBack ? { category: parseHotParams(query).category } : null,
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
