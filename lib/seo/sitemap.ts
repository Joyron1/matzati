// Sitemap entries, built from plain inputs so the rules are unit-tested. app/sitemap.ts gathers
// the inputs (published deals, published landing pages) and handles failures.
import type { MetadataRoute } from "next";
import type { SeoPage } from "./db";
import { seoPath } from "./slug";

/** Pages that always exist and are meant to be found. */
export const STATIC_PATHS = ["/disclosure", "/privacy", "/terms"] as const;

export function buildSitemap(input: {
  /** SITE_URL, without a trailing slash. */
  origin: string;
  /** /deals is listed only while it has something to show (same rule as the menu link). */
  hasDeals: boolean;
  pages: Pick<SeoPage, "slug" | "updated_at">[];
}): MetadataRoute.Sitemap {
  const { origin } = input;
  const seen = new Set<string>();
  const seoEntries: MetadataRoute.Sitemap = [];
  for (const page of input.pages) {
    const url = `${origin}${seoPath(page.slug)}`;
    if (seen.has(url)) continue;
    seen.add(url);
    seoEntries.push({
      url,
      lastModified: page.updated_at,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }
  return [
    { url: origin, changeFrequency: "daily", priority: 1 },
    ...(input.hasDeals
      ? [{ url: `${origin}/deals`, changeFrequency: "daily" as const, priority: 0.7 }]
      : []),
    ...seoEntries,
    ...STATIC_PATHS.map((path) => ({
      url: `${origin}${path}`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
}
