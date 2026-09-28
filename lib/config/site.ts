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

/** Production host, used when Vercel does not tell us (local dev, tests, other hosts). */
export const DEFAULT_SITE_HOST = "matzati-il.vercel.app";

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;

/**
 * SITE_URL: the absolute origin of the production site, without a trailing slash, for canonical
 * URLs, the sitemap, robots.txt and JSON-LD. Vercel sets VERCEL_PROJECT_PRODUCTION_URL (a host
 * such as "matzati-il.vercel.app", or the custom domain once there is one) at build and run time.
 * Server-side only: the variable is not exposed to the browser bundle.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const host = (env.VERCEL_PROJECT_PRODUCTION_URL ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${HOSTNAME.test(host) ? host : DEFAULT_SITE_HOST}`;
}

/** SITE_URL + path, e.g. absoluteUrl("/sitemap.xml"). `path` must start with "/". */
export function absoluteUrl(path: string, env?: Record<string, string | undefined>): string {
  return `${siteUrl(env)}${path.startsWith("/") ? path : `/${path}`}`;
}
