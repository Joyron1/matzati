// A shared SEO landing page's card: its title and the photos of its first stored results
// (lib/og/pages.ts, stored data only: never the live search a page without results runs).
import { OG_PHOTO_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { seoImage } from "@/lib/og/pages";

export const alt = "שם העמוד ותמונות של המוצרים בו";
export const size = OG_SIZE;
export const contentType = OG_PHOTO_CONTENT_TYPE;
// Like the page itself (ISR, a day).
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  return seoImage((await params).slug);
}
