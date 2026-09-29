// Which product photo URLs we render, and how they are sized. Mirrors images.remotePatterns in
// next.config.ts: next/image throws on any other host, so an unexpected URL is left out (or shown
// as a placeholder) instead of breaking the page.
const IMAGE_HOST_SUFFIX = ".aliexpress-media.com";

/** True for an https URL on the AliExpress image CDN. */
export function isAllowedImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.endsWith(IMAGE_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * The resized copies AliExpress's image host serves at "<url>_<s>x<s>.jpg" (WebP, checked
 * 2026-09-29: other sizes return the original). Photos are sized by this loader, never by Vercel's
 * image optimizer: Hobby allows 5,000 optimized source images a month, and past it the optimizer
 * answers 402 and every card shows a broken photo (that happened on 2026-09-29 after the SEO pages
 * grew to 50 products each).
 */
export const ALI_IMAGE_SIZES = [220, 350, 480, 640] as const;

/** A photo URL with the size suffix; a URL that is not a JPEG or PNG on the CDN is left as is. */
export function aliImageUrl(src: string, width: number): string {
  if (!isAllowedImage(src) || !/\.(jpe?g|png)$/i.test(src)) return src;
  const size = ALI_IMAGE_SIZES.find((s) => s >= width);
  return size ? `${src}_${size}x${size}.jpg` : src;
}

/** next/image `loader`: the smallest CDN copy at least `width` wide, or the original past 640. */
export function aliImageLoader({ src, width }: { src: string; width: number }): string {
  return aliImageUrl(src, width);
}
