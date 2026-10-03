// GET /llms.txt: the site for AI search engines and assistants, in Markdown (lib/seo/llms.ts).
// Static and regenerated once a day; the landing pages are read the way app/sitemap.ts reads
// them, and a database failure leaves that section out instead of failing the file.
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasPublishedDeals, hasUpcomingSales } from "@/lib/deals/queries";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { listPublishedSeoPages } from "@/lib/seo/queries";

export const revalidate = 86400;

export async function GET() {
  const [hasDeals, hasSales, hasCoupons, pages] = await Promise.all([
    hasPublishedDeals(), // never throws: a failure reads as "no deals"
    hasUpcomingSales(), // likewise
    hasPublishedCoupons(), // likewise
    listPublishedSeoPages().catch((err: unknown) => {
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`[llms.txt] ${text.slice(0, 300)}`);
      return null;
    }),
  ]);
  return new Response(buildLlmsTxt({ pages, hasCoupons, hasSales, hasDeals }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
