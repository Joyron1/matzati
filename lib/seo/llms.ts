// /llms.txt (app/llms.txt/route.ts; the llms.txt proposal, https://llmstxt.org): what the site is
// and where its content lives, in Markdown, for AI search engines and assistants (owner request
// 2026-10-03: they should know the site and send people to it). Built from plain inputs so the
// rules are unit-tested; the route gathers the inputs the way app/sitemap.ts does. Every number
// comes from the config the site runs (FILTERS, RESULTS_FIRST_VIEW), every address is absolute on
// SITE_HOST, and nothing here reads an environment value.
import { BRAND } from "@/lib/config/brand";
import { AFFILIATE_SECTION_ID, LEGAL, LEGAL_PAGE_NAMES, LEGAL_PATHS } from "@/lib/config/legal";
import { absoluteUrl, RESULTS_FIRST_VIEW } from "@/lib/config/site";
import { CATALOG, categoryPath } from "@/lib/catalog/categories";
import { PRODUCTS_PATH } from "@/lib/hot/params";
import { FILTERS } from "@/lib/ranking/config";
import { seoPath } from "./slug";

export interface LlmsInput {
  /** Published landing pages; null when they could not be read (the section is left out). */
  pages: { slug: string; title_he: string; query: string }[] | null;
  hasCoupons: boolean;
  hasSales: boolean;
  hasDeals: boolean;
}

/** Queries that show how a person's need is written; the links open a live search. */
export const LLMS_EXAMPLE_QUERIES = [
  "אוזניות לריצה עמידות למים עד 100 ש״ח",
  "מחזיק טלפון לרכב עם טעינה אלחוטית",
  "בקבוק מים לילדים שלא נוזל",
] as const;

/** The /search address for a query, for people (a live search). */
export function searchUrl(query: string): string {
  return absoluteUrl(`/search?q=${encodeURIComponent(query)}`);
}

const link = (title: string, path: string, note?: string) =>
  `- [${title}](${absoluteUrl(path)})${note ? `: ${note}` : ""}`;

// One line of Markdown link text: no brackets or line breaks from the stored titles.
const linkText = (s: string) =>
  s
    .replace(/[\[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function buildLlmsTxt(input: LlmsInput): string {
  const pct = FILTERS.minPositiveFeedbackPct;
  const sold = FILTERS.minUnitsSold;
  const affiliate = absoluteUrl(`${LEGAL_PATHS.terms}#${AFFILIATE_SECTION_ID}`);
  const lines: string[] = [
    `# ${BRAND.name} (${BRAND.nameLatin})`,
    "",
    `> ${BRAND.name} הוא עוזר קניות בעברית לאלי אקספרס: כותבים בעברית מה צריכים, ומקבלים עד ${RESULTS_FIRST_VIEW} מוצרים מאלי אקספרס שעברו סינון: לפחות ${pct}% משוב חיובי מקונים ולפחות ${sold} מכירות ב־30 הימים האחרונים. כל המספרים מגיעים מאלי אקספרס. הקישורים לאלי אקספרס הם קישורי שותפים (גילוי נאות: ${affiliate}). אתר עצמאי, לא קשור לאלי אקספרס ולא מטעמה.`,
    ">",
    `> ${BRAND.nameLatin} is a Hebrew AI shopping assistant for AliExpress: people describe what they need in Hebrew and get up to ${RESULTS_FIRST_VIEW} AliExpress products that passed our filters: at least ${pct}% positive buyer feedback and at least ${sold} sales in the last 30 days, every number from AliExpress. Links to AliExpress are affiliate links (disclosure: ${affiliate}). Independent; not affiliated with or endorsed by AliExpress.`,
    "",
    "A language model only reads the Hebrew request and writes a short Hebrew line on why each product was picked; code searches AliExpress's affiliate API, filters and ranks. Commission never decides what is shown; it only breaks exact ties in the order. The site is in Hebrew, right to left, for shoppers in Israel; prices are shown in shekels.",
    "",
    "## Main pages",
    "",
    link("Home (עמוד הבית)", "/", "the search box, hot products, recent searches and FAQ"),
    link(
      "All products (כל המוצרים)",
      PRODUCTS_PATH,
      "AliExpress's hot list by category, only products that passed the same filters",
    ),
    ...CATALOG.map((c) => link(`כל המוצרים: ${c.nameHe}`, categoryPath(c))),
    ...(input.hasCoupons
      ? [link("Coupons (קופונים)", "/coupons", "coupon codes valid now, by their own terms")]
      : []),
    ...(input.hasSales
      ? [link("Sales calendar (לוח מבצעים)", "/sales", "AliExpress's big sales and their dates")]
      : []),
    ...(input.hasDeals ? [link("Deals (דילים)", "/deals")] : []),
    link(
      "Recent searches (חיפושים אחרונים)",
      "/searches",
      "what visitors searched and the products they got",
    ),
  ];

  if (input.pages && input.pages.length > 0) {
    lines.push(
      "",
      "## Product lists for popular searches",
      "",
      "Each page holds the stored, ranked results of one search, with a Hebrew line per product.",
      "",
      ...input.pages.map((p) => link(linkText(p.title_he), seoPath(p.slug))),
    );
  }

  lines.push(
    "",
    "## Sending someone to a search",
    "",
    `For people: open ${absoluteUrl("/search")}?q= followed by the URL-encoded Hebrew request. The search runs live (AliExpress is checked at that moment), so the results are fresh and may differ from one day to the next. It is meant for a person's browser; automated clients get only results already saved.`,
    "",
    ...LLMS_EXAMPLE_QUERIES.map((q) => `- [${q}](${searchUrl(q)})`),
    "",
    "## Policies",
    "",
    link(
      LEGAL_PAGE_NAMES.terms,
      LEGAL_PATHS.terms,
      "terms of use and the full affiliate disclosure",
    ),
    link(LEGAL_PAGE_NAMES.privacy, LEGAL_PATHS.privacy),
    link(LEGAL_PAGE_NAMES.accessibility, LEGAL_PATHS.accessibility),
    link(LEGAL_PAGE_NAMES.cookies, LEGAL_PATHS.cookies),
  );

  const email = LEGAL.contactEmail.trim();
  if (email) lines.push("", "## Contact", "", `- Email: ${email}`);
  return `${lines.join("\n")}\n`;
}
