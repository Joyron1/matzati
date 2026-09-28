// Everything a landing page (/s/[slug]) shows: the published row and its results. The results are
// the page's stored snapshot (lib/seo/snapshot.ts), refreshed about weekly by the cron and when
// the admin publishes the page; only a page without one runs its query live, once, and stores the
// run when it has results. Server-only: runs inside the page's (ISR) render.
import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { SearchResponse } from "@/lib/types";
import { getPublishedSeoPage, getPublishedSnapshot, type SeoPage } from "./queries";
import { seoRefresher } from "./refresh-server";
import { parseSlugParam } from "./slug";
import { readSnapshot, resultsAtOf } from "./snapshot";

export interface SeoPageView {
  page: SeoPage;
  /** Results for page.query; null when the page has no snapshot and its live run failed. */
  response: SearchResponse | null;
  /** When those results were fetched from AliExpress (ISO); null without results. */
  checkedAt: string | null;
}

// A page rendered while the live run is failing must not stay cached for a day. unstable_cache
// lowers the revalidate time of the render that calls it to its own, so calling this caps the
// fallback page's lifetime at 10 minutes. (examplePreview remembers a failure for 10 minutes too,
// so the retry does not start a paid run on every render.) A refresh that stores a snapshot
// revalidates the page at once.
const retrySoon = unstable_cache(async () => true, ["seo-fallback-retry"], { revalidate: 600 });

/**
 * The landing page for a [slug] param, or null for a 404 (not a slug, no such page, or a draft).
 * A database failure throws, so a hiccup never gets cached as a 404 or as a page without its
 * stored results. The live run of a page without a snapshot is examplePreview (real pipeline,
 * daily LLM budget, 14-day cache, no per-visitor limit). Wrapped in cache() so generateMetadata
 * and the page share one lookup per render.
 */
export const seoPageView = cache(async (slugParam: string): Promise<SeoPageView | null> => {
  const slug = parseSlugParam(slugParam);
  if (!slug) return null;
  const page = await getPublishedSeoPage(slug);
  if (!page) return null;
  const stored = await getPublishedSnapshot(slug);
  const snapshot = stored ? readSnapshot(stored, page.query) : null;
  if (snapshot) return { page, response: snapshot.response, checkedAt: snapshot.resultsAt };

  const run = await seoRefresher.firstRun(page.slug, page.query, stored?.resultsAt ?? null);
  if (!run.ok) {
    await retrySoon().catch(() => undefined);
    return { page, response: null, checkedAt: null };
  }
  return { page, response: run.response, checkedAt: resultsAtOf(run.response, new Date()) };
});
