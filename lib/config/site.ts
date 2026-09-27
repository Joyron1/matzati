export const RESULTS_PER_PAGE = 3;

/** /deals (menu, footer, the page itself and the countdown's reminder link). Live since M5. */
export const DEALS_ENABLED = true;

/** The home page preview runs this query for real (from the 14-day cache after the first run). */
export const EXAMPLE_QUERY = "אוזניות לריצה, עמידות למים, עד 100 ש״ח";

/** Results fetched longer ago than this say on /search when their prices were checked. */
export const STALE_RESULTS_HOURS = 24;

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
