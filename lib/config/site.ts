/** Products per results page, and per "עוד N אפשרויות" (owner decision 2026-09-28: 5, was 3). */
export const RESULTS_PER_PAGE = 5;

/**
 * Ranked products a search keeps (the result set it caches): three pages. "עוד N אפשרויות" shows
 * pages two and three from it, and a fetch saves every one of them to `products` (/p's similar
 * products read them).
 */
export const RESULTS_KEPT = 3 * RESULTS_PER_PAGE;

/** /deals (menu, footer, the page itself and the countdown's reminder link). Live since M5. */
export const DEALS_ENABLED = true;

/** Results fetched longer ago than this say on /search when their prices were checked. */
export const STALE_RESULTS_HOURS = 24;

/**
 * /go makes a new affiliate link (link.generate) for a stored product whose link is older than
 * this. AliExpress may invalidate a short link that is over a year old or unused for 6 months
 * (Affiliate Program Service Agreement 5.4); 90 days stays well inside both.
 */
export const LINK_MAX_AGE_DAYS = 90;

/**
 * Colors and sizes on /p (product.sku.detail.get). Off until the owner gets the method approved in
 * the AliExpress console (InsufficientPermission on 2026-09-28) and one real call confirms its
 * response shape (docs/aliexpress-api.md).
 */
export const SKU_DETAILS_ENABLED = false;

/**
 * The site's official host (owner's domain, 2026-09-29). matzati-il.com redirects here (Vercel
 * domain settings) and so does the old matzati-il.vercel.app (LEGACY_SITE_HOST, next.config.ts).
 */
export const SITE_HOST = "www.matzati-il.com";

/** The address the site had before its domain: every page on it redirects to SITE_HOST. */
export const LEGACY_SITE_HOST = "matzati-il.vercel.app";

/**
 * SITE_URL: the absolute origin of the production site, without a trailing slash, for canonical
 * URLs, Open Graph, the sitemap, robots.txt, JSON-LD and calendar files. Always SITE_HOST, also in
 * previews and dev, so a shared or indexed address is never one that redirects. Not read from
 * VERCEL_PROJECT_PRODUCTION_URL: Vercel sets it to the shortest production domain, the bare
 * matzati-il.com, which redirects.
 */
export function siteUrl(): string {
  return `https://${SITE_HOST}`;
}

/** SITE_URL + path, e.g. absoluteUrl("/sitemap.xml"). `path` must start with "/". */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
