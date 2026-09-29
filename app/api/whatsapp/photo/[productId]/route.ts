// A product photo as a JPEG, for the WhatsApp cards (lib/whatsapp/photo.ts says why). Reads the
// stored product only: never a refresh, a search or an AliExpress API call. Cached by the CDN.
// Off (404) with the bot, like the webhook.
import { SupabaseStore } from "@/lib/search/supabase-store";
import { serviceClient } from "@/lib/supabase/server";
import { whatsappEnabled } from "@/lib/whatsapp/config";
import { fetchPhotoJpeg } from "@/lib/whatsapp/photo";

export const maxDuration = 15;

const PRODUCT_ID = /^\d{1,20}$/;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });

export async function GET(_request: Request, ctx: RouteContext<"/api/whatsapp/photo/[productId]">) {
  if (!whatsappEnabled()) return notFound();
  const { productId } = await ctx.params;
  if (!PRODUCT_ID.test(productId)) return notFound();
  const stored = await new SupabaseStore(serviceClient()).getProduct(productId).catch(() => null);
  const { mainImageUrl, imageUrls } = stored?.product ?? {};
  const jpeg = await fetchPhotoJpeg(mainImageUrl || imageUrls?.[0]);
  if (!jpeg) return notFound();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
