// A shared product link's card: the product's photo and title (lib/og/pages.ts, stored data only).
import { OG_PHOTO_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { productImage } from "@/lib/og/pages";

export const alt = "תמונת המוצר ושמו";
export const size = OG_SIZE;
export const contentType = OG_PHOTO_CONTENT_TYPE;
// Made on the first request and kept a day, like the product's stored data.
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ productId: string }> }) {
  return productImage((await params).productId);
}
