import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config/site";
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasPublishedDeals, hasUpcomingSales } from "@/lib/deals/queries";
import { listPublishedSeoPages } from "@/lib/seo/queries";
import { buildSitemap } from "@/lib/seo/sitemap";

// Cached like a static route and regenerated in the background. Admin changes to landing pages
// call revalidatePath("/sitemap.xml") so new pages are listed right away.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const [hasDeals, hasSales, hasCoupons, pages] = await Promise.all([
    hasPublishedDeals(), // never throws: a failure reads as "no deals"
    hasUpcomingSales(), // likewise
    hasPublishedCoupons(), // likewise
    listPublishedSeoPages().catch((err: unknown) => {
      // A database hiccup leaves the landing pages out of this version instead of failing it.
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`[sitemap] ${text.slice(0, 300)}`);
      return [];
    }),
  ]);
  // /sales and /coupons are listed only while they have something to show, like /deals (and the
  // menu links). They go right after the home page.
  const offers: MetadataRoute.Sitemap = [
    ...(hasSales ? ["/sales"] : []),
    ...(hasCoupons ? ["/coupons"] : []),
  ].map((path) => ({ url: `${origin}${path}`, changeFrequency: "daily", priority: 0.7 }));
  const [home, ...rest] = buildSitemap({ origin, hasDeals, pages });
  return [home, ...offers, ...rest];
}
