// A page's title, description and address, the same in search results and in a shared link's
// preview (Open Graph, X). Next merges metadata shallowly: a page that sets no openGraph shows the
// root layout's (the home page's title and address), so every public page sets its own through
// this. Next does not add a parent segment's opengraph-image file to a page that sets openGraph
// either, so the brand card (app/opengraph-image.tsx) is named here; a page with its own image
// file (/p, /s) passes ownImage and its file fills the tags.
import type { Metadata } from "next";
import { BRAND } from "@/lib/config/brand";
import { absoluteUrl } from "@/lib/config/site";
import { OG_SIZE } from "@/lib/og/size";

/** The brand card (app/opengraph-image.tsx) as an image entry. */
const BRAND_IMAGE = { url: "/opengraph-image", ...OG_SIZE, alt: `${BRAND.name}: ${BRAND.tagline}` };

/** Fields every page's Open Graph shares. */
export const OG_BASE = { type: "website", locale: "he_IL", siteName: BRAND.name } as const;

export interface PageMetaInput {
  /** The page's own title; the tab and the preview add " | <brand>". */
  title: string;
  description: string;
  /** The page's path (with a query when that is the page, as in /search?q=). */
  path: string;
  /** Adds a canonical link to `path` (default true). */
  canonical?: boolean;
  /** The page has its own opengraph-image and twitter-image files (default false: the brand card). */
  ownImage?: boolean;
}

export function pageMetadata({
  title,
  description,
  path,
  canonical = true,
  ownImage = false,
}: PageMetaInput): Metadata {
  const url = absoluteUrl(path);
  const shared = `${title} | ${BRAND.name}`;
  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical: url } } : {}),
    openGraph: {
      ...OG_BASE,
      url,
      title: shared,
      description,
      ...(ownImage ? {} : { images: [BRAND_IMAGE] }),
    },
    twitter: {
      card: "summary_large_image",
      title: shared,
      description,
      ...(ownImage ? {} : { images: [BRAND_IMAGE] }),
    },
  };
}
