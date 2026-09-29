// The cards of pages with their own content: a product (/p) and an SEO landing page (/s). Read
// what is stored only: never a refresh, a search or an AliExpress API call (a crawler must not
// spend budget), and anything missing or failing gives the brand card.
import "server-only";
import { BRAND } from "@/lib/config/brand";
import { productTitleView } from "@/lib/product-title";
import { SupabaseStore } from "@/lib/search/supabase-store";
import { getPublishedSeoPage, getPublishedSnapshot } from "@/lib/seo/queries";
import { shownGroups } from "@/lib/seo/results";
import { parseSlugParam } from "@/lib/seo/slug";
import { readSnapshot } from "@/lib/seo/snapshot";
import { serviceClient } from "@/lib/supabase/server";
import { brandCard, listCard, productCard } from "./card";
import { imageDataUri } from "./image";

const PRODUCT_ID = /^\d{1,20}$/;

export async function productImage(productId: string) {
  if (!PRODUCT_ID.test(productId)) return brandCard("jpeg");
  const stored = await new SupabaseStore(serviceClient()).getProduct(productId).catch(() => null);
  if (!stored) return brandCard("jpeg");
  const { title, mainImageUrl, imageUrls } = stored.product;
  const view = productTitleView(stored.titleHe ?? title, title);
  return productCard({ title: view.text, image: await imageDataUri(mainImageUrl || imageUrls[0]) });
}

export async function seoImage(slugParam: string) {
  const slug = parseSlugParam(slugParam);
  const page = slug ? await getPublishedSeoPage(slug).catch(() => null) : null;
  if (!page) return brandCard("jpeg");
  const stored = await getPublishedSnapshot(page.slug).catch(() => null);
  // The first shown group: the page's places 1-5, never a pending group or a waiting `next` run.
  const snapshot = stored ? readSnapshot(stored, page.query) : null;
  const lead = snapshot ? (shownGroups(snapshot.results)[0] ?? []) : [];
  const photos = await Promise.all(lead.slice(0, 4).map((p) => imageDataUri(p.image_urls[0])));
  return listCard({
    eyebrow: `מוצרים מאלי אקספרס ב${BRAND.name}`,
    title: page.title_he,
    subtitle: "רק מוצרים שעברו סינון לפי משוב של קונים ומספר מכירות.",
    images: photos.filter((p): p is string => p !== null),
  });
}
