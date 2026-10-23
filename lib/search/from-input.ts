// Search by image or by a product link from another site (owner request 2026-10-23). Both end as
// a short Hebrew query for the usual search (the smart search stays the one engine): an image is
// described by the site's LLM (vision), a page is read for its product name (og:title, JSON-LD,
// <title>, else the address's words) and the LLM turns that into a query. An AliExpress product
// link goes straight to our product page instead. Server-only; the routes guard and rate-limit.
import "server-only";
import { z } from "zod";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";

/** The query the search runs: 2 to 80 characters, Hebrew or Latin letters. */
export const QUERY_MAX = 80;

const querySchema = z.object({
  /** A short shopping query in Hebrew, as an Israeli would type it. Empty when nothing found. */
  query_he: z.string(),
});

const IMAGE_SYSTEM = `You see a photo a shopper uploaded to find the same kind of product on AliExpress. Write query_he: a short Hebrew shopping search (2 to 7 words) naming the product type and its 1-3 most distinctive visible attributes (color, material, style, shape, or a brand, character or franchise name written in Latin letters exactly as shown). No prices, sizes or numbers you cannot see, no full sentences. If the photo shows no product, return an empty string.`;

const LINK_SYSTEM = `You get the name of a product from an online store page (any language) and maybe its brand. Write query_he: a short Hebrew shopping search (2 to 7 words) for the same kind of product on AliExpress: the product type and its 1-3 key features (keep a brand, model, character or franchise name in Latin letters). Drop marketing words, store names, sizes lists and prices. If the text names no product, return an empty string.`;

export interface QueryOutcome {
  query: string | null;
  usage: LlmUsage | null;
  model: string | null;
}

function cleanQuery(raw: string | undefined): string | null {
  const q = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
  return q.length >= 2 && /[֐-׿A-Za-z]/.test(q) ? q : null;
}

/** The query for an uploaded photo (already resized to a JPEG of at most 1024 px). */
export async function queryFromImage(llm: LlmProvider, jpeg: Buffer): Promise<QueryOutcome> {
  const res = await llm.generateStructured({
    system: IMAGE_SYSTEM,
    user: "מה המוצר בתמונה? כתבו חיפוש קצר בעברית.",
    images: [{ mediaType: "image/jpeg", data: jpeg.toString("base64") }],
    schema: querySchema,
    maxTokens: 300,
    timeoutMs: 20_000,
    maxRetries: 1,
  });
  return { query: cleanQuery(res.data?.query_he), usage: res.usage, model: res.model };
}

/** The query for a product's name (and brand) read from another store's page. */
export async function queryFromProductName(
  llm: LlmProvider,
  name: string,
  brand: string | null,
): Promise<QueryOutcome> {
  const res = await llm.generateStructured({
    system: LINK_SYSTEM,
    user: JSON.stringify({ name: name.slice(0, 400), brand: brand?.slice(0, 80) ?? null }),
    schema: querySchema,
    maxTokens: 300,
    timeoutMs: 15_000,
    maxRetries: 1,
  });
  return { query: cleanQuery(res.data?.query_he), usage: res.usage, model: res.model };
}

// --- Reading a link ------------------------------------------------------------------------------

/** An AliExpress product id in an item address (/item/<id>.html), or null. */
export function aliexpressItemId(url: URL): string | null {
  if (!/(^|\.)aliexpress\.(com|us|ru)$/i.test(url.hostname)) return null;
  return /\/item\/(\d{6,20})\.html/.exec(url.pathname)?.[1] ?? null;
}

/** AliExpress's short links (s.click, a.aliexpress.com/_x): followed to find the item. */
export function isAliexpressShortLink(url: URL): boolean {
  return /^(s\.click|a)\.aliexpress\.com$/i.test(url.hostname);
}

/**
 * A link we may fetch: http(s), a public host name (no IP address, localhost, single-label or
 * internal name), standard ports. Never an internal address (SSRF).
 */
export function fetchableUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return null;
  return url;
}

export interface PageProduct {
  name: string | null;
  brand: string | null;
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .trim();

function meta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']{2,400})["']|<meta[^>]+content=["']([^"']{2,400})["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const m = re.exec(html);
  return m ? decode(m[1] ?? m[2]) : null;
}

/** The product's name and brand from a store page: JSON-LD Product, og:title, <title>. */
export function productFromHtml(html: string): PageProduct {
  for (const block of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data: unknown = JSON.parse(block[1]);
      const items = (Array.isArray(data) ? data : [data]).flatMap((d) =>
        d && typeof d === "object" && "@graph" in d
          ? (d as { "@graph": unknown[] })["@graph"]
          : [d],
      );
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const type = String(o["@type"] ?? "");
        if (/Product/i.test(type) && typeof o.name === "string") {
          const brand = o.brand as { name?: unknown } | string | undefined;
          return {
            name: decode(o.name),
            brand:
              typeof brand === "string"
                ? brand
                : typeof brand?.name === "string"
                  ? brand.name
                  : null,
          };
        }
      }
    } catch {
      // Not JSON; try the next block.
    }
  }
  const title =
    meta(html, "og:title") ??
    meta(html, "twitter:title") ??
    /<title[^>]*>([^<]{2,400})<\/title>/i.exec(html)?.[1] ??
    null;
  return { name: title ? decode(title) : null, brand: null };
}

/** The words of a product address (/dp/…/Wireless-Earbuds-Bluetooth-5-3/…): a last resort. */
export function wordsFromUrl(url: URL): string | null {
  const words = decodeURIComponent(url.pathname)
    .split(/[/_\-+.]+/)
    .filter(
      (w) =>
        /^[\p{L}][\p{L}\d]{1,}$/u.test(w) && !/^(dp|item|product|products|p|html|www)$/i.test(w),
    );
  return words.length >= 2 ? words.slice(0, 12).join(" ") : null;
}

/**
 * Fetches a store page (up to 3 redirects, each checked with fetchableUrl; 8 s; the first 1.5 MB)
 * and returns its final address and HTML, or null when it cannot be read (blocked, not HTML).
 */
export async function fetchPage(
  start: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: URL; html: string | null } | null> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchImpl(url, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "he,en;q=0.8",
      },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (!res) return { url, html: null };
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      const nextUrl = next ? fetchableUrl(new URL(next, url).toString()) : null;
      if (!nextUrl) return { url, html: null };
      url = nextUrl;
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html") || !res.body) {
      return { url, html: null };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 1_500_000) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => undefined);
    return { url, html: Buffer.concat(chunks).toString("utf8") };
  }
  return { url, html: null };
}
