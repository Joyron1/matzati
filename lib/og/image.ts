// Product photos for the Open Graph cards. Fetched by us, not by the renderer, so a slow or broken
// photo gives a card without it instead of a failed image. Only AliExpress's image host (the same
// check as next/image), JPEG or PNG (what the renderer draws), at most 1.5 MB, 4 s.
import "server-only";
import { isAllowedImage } from "@/lib/images";

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 4000;

/** AliExpress serves a smaller copy of a photo at "<url>_<w>x<h>.jpg"; the card needs no more. */
export function smallImageUrl(src: string, size = 480): string {
  return /\.(jpe?g|png)$/i.test(src) ? `${src}_${size}x${size}.jpg` : src;
}

async function fetchOnce(src: string): Promise<string | null> {
  const res = await fetch(src, {
    headers: { Accept: "image/jpeg,image/png" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!res.ok || !/^image\/(jpeg|png)$/.test(type)) return null;
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.length || body.length > MAX_BYTES) return null;
  return `data:${type};base64,${body.toString("base64")}`;
}

/** The photo as a data URI, or null when it is not an allowed, readable JPEG or PNG. */
export async function imageDataUri(src: string | undefined): Promise<string | null> {
  if (!src || !isAllowedImage(src)) return null;
  try {
    return (await fetchOnce(smallImageUrl(src))) ?? (await fetchOnce(src));
  } catch {
    try {
      return await fetchOnce(src);
    } catch {
      return null;
    }
  }
}
