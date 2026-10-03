// Structured data and meta text for the SEO landing pages. Pure: every value comes from the page
// row or from the products the page shows. No ratings, offers or prices are added here: the
// schema.org list points to our own product pages, which show the real, dated numbers.
import { BRAND } from "@/lib/config/brand";
import type { ResultProduct } from "@/lib/types";
import type { SeoPage } from "./db";

export const DESCRIPTION_MAX = 155;

/** Cuts text at a word boundary so it fits `max` characters, ending with "…" when cut. */
export function truncateAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Keep the cut as is when it already ends a word; otherwise drop the partial last word,
  // unless that would throw away more than half.
  const base = clean[max - 1] === " " ? cut : lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,.;:!?־-]+$/, "")}…`;
}

/** Meta description: the admin's intro, or a sentence that only states what the page does. */
export function seoDescription(page: Pick<SeoPage, "title_he" | "intro_he">): string {
  if (page.intro_he?.trim()) return truncateAtWord(page.intro_he, DESCRIPTION_MAX);
  return truncateAtWord(
    `${page.title_he}: מוצרים מאלי אקספרס שעברו סינון לפי משוב של קונים ומספר מכירות. ${BRAND.name} מראה רק את מה שעבר.`,
    DESCRIPTION_MAX,
  );
}

/** Title for the browser tab and search results: "<title_he> | מצאתי". */
export function seoTitle(page: Pick<SeoPage, "title_he">): string {
  return `${page.title_he} | ${BRAND.name}`;
}

type ListedProduct = Pick<ResultProduct, "product_id" | "title_he" | "image_urls">;

/**
 * schema.org ItemList of the products shown, in the order shown, each pointing to our /p page.
 * `origin` is SITE_URL; `pageUrl` is the landing page's canonical URL.
 */
export function itemListJsonLd(input: {
  origin: string;
  pageUrl: string;
  name: string;
  products: ListedProduct[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.name,
    url: input.pageUrl,
    numberOfItems: input.products.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: input.products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${input.origin}/p/${encodeURIComponent(p.product_id)}`,
      name: p.title_he,
      ...(p.image_urls[0] ? { image: p.image_urls[0] } : {}),
    })),
  };
}

/**
 * schema.org BreadcrumbList of a page's path, the page itself last. `items` are absolute URLs
 * (SITE_URL + path); the last item may omit its URL, as Google allows for the current page.
 */
export function breadcrumbJsonLd(items: { name: string; url?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}

/**
 * JSON for a <script type="application/ld+json">. "<" is escaped so no value (a product title
 * from AliExpress, say) can close the script tag.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
