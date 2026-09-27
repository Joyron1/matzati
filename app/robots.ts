import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config/site";

// /search stays out of the index through its own noindex meta tag (it must stay crawlable for
// that tag to be seen). Landing pages for popular searches live under /s/ and are listed in the
// sitemap. /dev/ holds development previews, a 404 in production.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/go/", "/admin", "/api/", "/dev/"] },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
