import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config/site";
import { hasPublishedDeals } from "@/lib/deals/queries";
import { listPublishedSeoPages } from "@/lib/seo/queries";
import { buildSitemap } from "@/lib/seo/sitemap";

// Cached like a static route and regenerated in the background. Admin changes to landing pages
// call revalidatePath("/sitemap.xml") so new pages are listed right away.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [hasDeals, pages] = await Promise.all([
    hasPublishedDeals(), // never throws: a failure reads as "no deals"
    listPublishedSeoPages().catch((err: unknown) => {
      // A database hiccup leaves the landing pages out of this version instead of failing it.
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`[sitemap] ${text.slice(0, 300)}`);
      return [];
    }),
  ]);
  return buildSitemap({ origin: siteUrl(), hasDeals, pages });
}
