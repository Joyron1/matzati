// Which product photo URLs we render. Mirrors images.remotePatterns in next.config.ts: next/image
// throws on any other host, so an unexpected URL is left out (or shown as a placeholder) instead
// of breaking the page.
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
