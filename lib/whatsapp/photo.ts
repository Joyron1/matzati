// Product photos for WhatsApp cards. AliExpress's image host serves WebP for every photo, whatever
// the URL ends in or the request asks for (checked 2026-09-30: even ".jpg" and "Accept:
// image/jpeg" answer WebP bytes), and WhatsApp shows only JPEG and PNG, so a card with the
// AliExpress URL fails with "Media upload error" (Graph error 131053). The route
// /api/whatsapp/photo/<productId> fetches the stored photo and converts it here.
import sharp from "sharp";
import { isAllowedImage } from "@/lib/images";

/** WhatsApp images: 5 MB at most; our JPEGs are far smaller. */
const MAX_SOURCE_BYTES = 5_000_000;
const TIMEOUT_MS = 5_000;
/** A card header shows at most this many pixels; larger only slows the download. */
const MAX_SIDE = 800;

/** Any image sharp can read, as an 8-bit RGB JPEG on white (a PNG's transparency becomes white). */
export async function toWhatsAppJpeg(source: Uint8Array): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/**
 * The stored photo as a JPEG, or null when the URL is not on AliExpress's image host, the fetch
 * fails or is too big, or the bytes are not an image.
 */
export async function fetchPhotoJpeg(
  src: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<Buffer | null> {
  if (!src || !isAllowedImage(src)) return null;
  try {
    const res = await fetchFn(src, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) return null;
    return await toWhatsAppJpeg(bytes);
  } catch {
    return null;
  }
}
