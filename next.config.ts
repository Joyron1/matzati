import type { NextConfig } from "next";
import { LEGACY_SITE_HOST, SITE_HOST } from "./lib/config/site";

/** The parameters of a filtered /products view (parseHotParams in lib/hot/params.ts). */
const PRODUCTS_VIEW_KEYS = ["price", "sort", "code", "video", "page"];
/** The parameters of a filtered category view (parseCategoryParams in lib/catalog/params.ts). */
const CATEGORY_VIEW_KEYS = [...PRODUCTS_VIEW_KEYS, "sub", "lists"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The site's CSS (about 14 KB) goes inline in every HTML document instead of a separate
  // render-blocking request: on a slow connection that request finished only at about 1.5 s,
  // behind the fonts and scripts sharing the link, and nothing painted before it (Lighthouse
  // 2026-09-30, every page).
  experimental: { inlineCss: true },
  // The old vercel.app address sends every page, with its path and query, to the official domain
  // (308), so old shared links and indexed pages keep working. /api stays: Vercel Cron and other
  // callers must reach the route itself, not a redirect. Other vercel.app hosts (previews) are
  // untouched.
  redirects: async () => [
    {
      source: "/:path((?!api/).*)",
      has: [{ type: "host", value: LEGACY_SITE_HOST }],
      destination: `https://${SITE_HOST}/:path`,
      permanent: true,
    },
  ],
  // The default views of "כל המוצרים" (no filter, sort, step or loaded lists) come from cached
  // routes (owner request 2026-10-08, Vercel CPU: rendered per request, crawlers included, these
  // pages cost a share of the quota). The address stays /products or /products/<slug>; a view with
  // any of these parameters renders per request as before. beforeFiles: /products is a page of
  // its own, which an ordinary rewrite would never reach.
  rewrites: async () => ({
    beforeFiles: [
      {
        source: "/products",
        missing: PRODUCTS_VIEW_KEYS.map((key) => ({ type: "query" as const, key })),
        destination: "/products-view",
      },
      {
        source: "/products/:slug",
        missing: CATEGORY_VIEW_KEYS.map((key) => ({ type: "query" as const, key })),
        destination: "/products-view/:slug",
      },
    ],
    afterFiles: [],
    fallback: [],
  }),
  images: {
    // Every next/image goes through lib/image-loader.ts (AliExpress's resized copies): Vercel's
    // optimizer is never used, since Hobby's monthly quota ran out on 2026-09-29 and it then
    // answers 402 (lib/images.ts).
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
    // Product images seen in real AliExpress affiliate responses (fixtures/aliexpress).
    remotePatterns: [{ protocol: "https", hostname: "**.aliexpress-media.com" }],
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
};

export default nextConfig;
