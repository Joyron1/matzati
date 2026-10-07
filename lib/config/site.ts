/** Products per results page, and per "עוד N אפשרויות" (owner decision 2026-09-28: 5, was 3). */
export const RESULTS_PER_PAGE = 5;

/**
 * Results on the first view of /search (owner decision 2026-09-30: 10, was one page of 5): places
 * 1 to RESULTS_PER_PAGE with their "why we picked it" lines (the explain call), then places 6-10
 * as standard product cards with a Hebrew title only (the titles call, lib/llm/titles.ts). The
 * second trust tier (FILL_TIER, lib/ranking/config.ts) tops a search up to this many.
 */
export const RESULTS_FIRST_VIEW = 2 * RESULTS_PER_PAGE;

/**
 * The first page "עוד N אפשרויות" loads on /search (loadMore's page index, 0-based): the page
 * right after the first view (2: places 11-15). The WhatsApp bot, which shows one page of 5 at a
 * time, still asks for page 1 (places 6-10) first.
 */
export const FIRST_MORE_PAGE = RESULTS_FIRST_VIEW / RESULTS_PER_PAGE;

/**
 * Ranked products a search keeps (the result set it caches): 50 (owner decision 2026-10-04, was
 * 20). The first view shows 10, "עוד N אפשרויות" the rest MORE_STEP at a time, and a fetch saves
 * every one of them to `products` (/p's similar products read them).
 */
export const RESULTS_KEPT = 10 * RESULTS_PER_PAGE;

/**
 * Cards per "עוד N אפשרויות" on /search after the first view (owner decision 2026-10-04): standard
 * cards with a Hebrew title (the titles call) and no "why we picked it" line. The WhatsApp bot
 * still pages by RESULTS_PER_PAGE with lines.
 */
export const MORE_STEP = 2 * RESULTS_PER_PAGE;

/**
 * Products an SEO landing page (/s/[slug]) shows at most (owner decision 2026-09-29): every product
 * of its query that passed the filters, in ranked order, up to this many, in groups of
 * RESULTS_PER_PAGE, each group explained by one explain call (lib/search/seo-run.ts).
 */
export const SEO_MAX_PRODUCTS = 50;

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

/**
 * Lifetime of the cached reads every page's layout makes (the owner settings, the header and
 * footer links, the sale bar; owner request 2026-10-08). Next gives a cached page the shortest
 * lifetime of what it read, so this is how often every static page and /p is made again: at 5
 * minutes, a crawler going through thousands of product pages had each one rendered on its visit
 * (most of the project's Vercel CPU). The admin's saves expire these reads at once (updateTag);
 * only what depends on the time alone (a sale or a code ending) may show up to a day late in a
 * menu link, and the sale bar hides an ended sale in the browser.
 */
export const LAYOUT_DATA_REVALIDATE_SECONDS = 86_400;
