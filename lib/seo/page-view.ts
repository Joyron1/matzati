// Everything a landing page (/s/[slug]) shows: the published row and real results for its query.
// Server-only: runs inside the page's (ISR) render.
import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { examplePreview } from "@/lib/search/server";
import type { SearchResponse } from "@/lib/types";
import { getPublishedSeoPage, resultsFetchedAt, type SeoPage } from "./queries";
import { parseSlugParam } from "./slug";

export interface SeoPageView {
  page: SeoPage;
  /** Real results for page.query; null when the search failed (the page shows a fallback). */
  response: SearchResponse | null;
  /** When those results were fetched from AliExpress (ISO); null when unknown. */
  fetchedAt: string | null;
}

// A page rendered while the search is failing must not stay cached for a day. unstable_cache
// lowers the revalidate time of the render that calls it to its own, so calling this caps the
// fallback page's lifetime at 10 minutes. (examplePreview remembers a failure for 10 minutes too,
// so the retry does not start a paid run on every render.)
const retrySoon = unstable_cache(async () => true, ["seo-fallback-retry"], { revalidate: 600 });

async function fetchedAtOf(response: SearchResponse): Promise<string | null> {
  const stored = await resultsFetchedAt(response.filters_key);
  if (stored) return stored;
  // A run that was not served from the cache fetched its results just now.
  return response.cached === false ? new Date().toISOString() : null;
}

/**
 * The landing page for a [slug] param, or null for a 404 (not a slug, no such page, or a draft).
 * A database failure throws, so a hiccup never gets cached as a 404. Results come from
 * examplePreview (real pipeline, daily LLM budget, 48h cache, no per-visitor limit).
 * Wrapped in cache() so generateMetadata and the page share one lookup per render.
 */
export const seoPageView = cache(async (slugParam: string): Promise<SeoPageView | null> => {
  const slug = parseSlugParam(slugParam);
  if (!slug) return null;
  const page = await getPublishedSeoPage(slug);
  if (!page) return null;
  const response = await examplePreview(page.query).catch(() => null);
  if (!response) {
    await retrySoon().catch(() => undefined);
    return { page, response: null, fetchedAt: null };
  }
  return { page, response, fetchedAt: await fetchedAtOf(response) };
});
