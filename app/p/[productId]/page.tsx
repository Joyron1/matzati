import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { firstParam } from "@/lib/search-url";
import { productForPage } from "@/lib/search/server";
import { ProductView } from "./product-view";

// A fresh search (parse, up to 3 AliExpress calls, explain) takes 7-15 s; give it room.
export const maxDuration = 60;

// productForPage is request-cached, so the metadata and the page share one lookup.
export async function generateMetadata({ params }: PageProps<"/p/[productId]">): Promise<Metadata> {
  const data = await productForPage((await params).productId);
  return { title: data?.product.title_he ?? "מוצר לא נמצא" };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/p/[productId]">) {
  const { productId } = await params;
  const q = firstParam((await searchParams).q)
    .trim()
    .slice(0, 200);
  const data = await productForPage(productId);
  if (!data) notFound();

  return <ProductView data={data} q={q} now={new Date()} />;
}
