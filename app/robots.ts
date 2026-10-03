import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config/site";

// Every crawler is welcome on the content pages, AI search engines and assistants included (owner
// request 2026-10-03: they should know the site and send people to it): the home page, /hot, the
// landing pages under /s/, the product pages under /p/, /coupons, /sales, /deals, /searches (its
// own noindex, follow keeps it out of the index while its links are followed), the legal pages,
// the sitemap and /llms.txt.
//
// Kept out, for every crawler: /search, the live search (it costs a language model call and
// AliExpress calls; it also says noindex, and a crawler that asks anyway is served only what is
// cached, lib/guard/bots.ts), /api/, /go/ (the affiliate click-out), /admin and /dev/ (development
// previews, a 404 in production).
//
// A crawler obeys only the most specific group that names it, so the named AI crawlers get the
// same rules as "*" in their own group: naming them says they are welcome, it never widens what
// they may read.
const DISALLOW = ["/search", "/api/", "/go/", "/admin", "/dev/"];
// Rules match by prefix, so "/search" would also shut /searches: the longer Allow wins there.
const ALLOW = ["/", "/searches", "/llms.txt"];

/** AI search engines, assistants and the crawlers behind their answers. */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Googlebot",
  "Bingbot",
  "Applebot",
  "Applebot-Extended",
  "Amazonbot",
  "DuckAssistBot",
  "meta-externalagent",
  "MistralAI-User",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ALLOW, disallow: DISALLOW },
      { userAgent: AI_CRAWLERS, allow: ALLOW, disallow: DISALLOW },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
