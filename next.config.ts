import type { NextConfig } from "next";
import { LEGACY_SITE_HOST, SITE_HOST } from "./lib/config/site";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
  images: {
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
