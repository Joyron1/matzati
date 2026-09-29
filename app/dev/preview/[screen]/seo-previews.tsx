// Development-only preview of an SEO landing page (/s/[slug]) with made-up stored results
// (./page.tsx dispatches to it): /dev/preview/seo-page renders the page's own header and
// SeoResultsView (app/s/[slug]/seo-results.tsx) over a fake snapshot of 50 products in groups of
// five. Nothing here reads the database, AliExpress or an LLM, and nothing links to /search or
// /s: the product links open /p of made-up ids (a 404).
//
// ?n=<products> (1-50, default 50), ?pending=<group> (the first group still waiting for its
// lines: the page shows the groups before it), ?stale=1 (results checked 8 days ago).
import type { ReactNode } from "react";
import { SeoPageHeader, SeoResultsView } from "@/app/s/[slug]/seo-results";
import { SEO_MAX_PRODUCTS } from "@/lib/config/site";
import { EXPLAIN_VERSION } from "@/lib/llm/explain";
import { chunk, SEO_RESULTS_VERSION, shownGroups, type SeoResults } from "@/lib/seo/results";
import type { ResultProduct } from "@/lib/types";

const IMG = (name: string) => `https://ae-pic-a1.aliexpress-media.com/kf/${name}`;
/** Photos from the product.query fixture (AliExpress's image CDN). */
const IMAGES = [
  "S1054b9147d9e485388688a21f0437e4dL.jpg",
  "Sc36c59e5fe24402c874d8cd16bbb123dD.jpg",
  "Scb7416e62d2d42ad8e070094cf5a9f60b.jpg",
  "S7dbdac86722a4bc4aa9d3c79c67a7190P.jpg",
  "S599b8deeab1e40588d8202ecb8a88e9bi.jpg",
  "S320805b5a05146c6a6ebd8b624f1eb9aG.jpg",
  "S77915714249b42d583972e4076b2b04dZ.jpg",
  "S208e59066ea64143963230db82f0e2148.jpg",
  "S2e87e57a7fc944399088a820931f12bbc.jpg",
  "S7b9e52a1027f4e21bf9eb89a4338ee35y.jpg",
  "S5d6b30ff6d9b4ec2869eeab07895e0d3e.jpg",
  "Sfecc881ce40e473aa689cf8947a36634V.jpg",
].map(IMG);

const QUERY = "תיק לכבלים לנסיעות";

const TITLES = [
  "תיק אחסון לכבלים ולמטענים, עמיד במים",
  "ארגונית כבלים לנסיעות עם תאים ורוכסן",
  "תיק כבלים קומפקטי עם רצועות גומי",
  "נרתיק נסיעות למטענים ולאוזניות, שתי שכבות",
  "תיק אחסון לאביזרי מחשב ולכבלי USB",
  "ארגונית נסיעות קשיחה לכבלים ולסוללת גיבוי",
  "תיק כבלים מבד אוקספורד עם ידית",
  "נרתיק כבלים קטן עם כיס רשת פנימי",
];

// Lines as the explain step writes them: a comparison names its own five.
const WHYS = [
  "תיק לכבלים עמיד במים עם תאים נפרדים, והזול מבין החמישה (נתונים מומצאים).",
  "ארגונית עם רוכסן כפול ורצועות גומי שמחזיקות את הכבלים במקום (נתונים מומצאים).",
  "מתאים לנסיעות, עם מקום למטען, לאוזניות ולסוללת גיבוי (נתונים מומצאים).",
  "הנמכר ביותר מבין החמישה, עם שתי שכבות ותאים לאביזרים קטנים (נתונים מומצאים).",
  "תיק קומפקטי שנכנס לתיק גב, עם ידית נשיאה ובד עמיד (נתונים מומצאים).",
];

function product(i: number): ResultProduct {
  const price = 18 + ((i * 7) % 43) + 0.9;
  const original = i % 3 === 0 ? null : Math.round(price * 1.9 * 10) / 10;
  // One of our titles was rejected: the card shows AliExpress's English title.
  const english = i === 8;
  const titleEn = `Travel Cable Organizer Bag Waterproof Electronics Storage Case (made-up ${i + 1})`;
  return {
    product_id: `10000000000020${String(i).padStart(2, "0")}`,
    title_he: english ? titleEn : `${TITLES[i % TITLES.length]} (לדוגמה ${i + 1})`,
    title_en: titleEn,
    why_he: WHYS[i % WHYS.length],
    price_ils: Math.round(price * 100) / 100,
    original_price_ils: original,
    price_is_approx: false,
    discount_pct: original ? Math.round((1 - price / original) * 100) : null,
    positive_feedback_pct: 94 + ((i * 3) % 60) / 10,
    units_sold: 12_000 - i * 210,
    passed_tier: "standard",
    // Two listings of a shop that shares numbers, as the ranking marks them.
    ...(i === 3 || i === 17 ? { shared_numbers: { feedback: true, sales: i === 17 } } : {}),
    image_urls: [IMAGES[i % IMAGES.length]],
    category_id: "1524",
  };
}

function previewResults(count: number, pendingFrom: number | null, fetchedAt: string): SeoResults {
  const products = Array.from({ length: count }, (_, i) => product(i));
  const groups = chunk(products.map((p) => p.product_id)).map((ids, k) => ({
    ids,
    state: pendingFrom !== null && k >= pendingFrom ? ("pending" as const) : ("model" as const),
  }));
  return {
    v: SEO_RESULTS_VERSION,
    query: QUERY,
    chips: [
      { id: "product", kind: "keywords", label_he: "תיק לכבלים", removable: false },
      { id: "req-travel", kind: "must_have", label_he: "לנסיעות", removable: true },
    ],
    sort: "best_value",
    checked_count: 250,
    passed_count: count + 13,
    fetched_at: fetchedAt,
    full: true,
    context: {
      product_he: "תיק לכבלים",
      requirements_he: ["לנסיעות"],
      sort_preference: "best_value",
    },
    explain_version: EXPLAIN_VERSION,
    results: products,
    groups,
  };
}

export function SeoPagePreview({
  params,
  now,
  note,
}: {
  params: Record<string, string | string[] | undefined>;
  now: Date;
  note: (text: string) => ReactNode;
}) {
  const n = Math.min(SEO_MAX_PRODUCTS, Math.max(1, Number(params.n) || SEO_MAX_PRODUCTS));
  const pending = Number(params.pending);
  const pendingFrom = Number.isInteger(pending) && pending >= 1 ? pending : null;
  const checked = new Date(now.getTime() - (params.stale === "1" ? 8 * 24 : 5) * 3_600_000);
  const results = previewResults(n, pendingFrom, checked.toISOString());
  const groups = shownGroups(results);
  return (
    <>
      {note(`כמו דף חיפוש (/s), עם ${n} מוצרים בקבוצות של 5.`)}
      <div className="mx-auto max-w-6xl space-y-8 px-4 pt-6 sm:px-6 sm:pt-10 xl:max-w-7xl">
        <SeoPageHeader
          title="תיקים לכבלים לנסיעות (לדוגמה)"
          intro="תיקים וארגוניות לכבלים, למטענים ולאוזניות, שעברו את הסינון שלנו. נתונים מומצאים לתצוגה מקדימה."
          checkedAt={results.fetched_at}
          now={now}
        />
        <SeoResultsView
          query={QUERY}
          chips={results.chips}
          checkedCount={results.checked_count}
          passedCount={results.passed_count}
          groups={groups}
          // The preview never links to /search, which would run a real search.
          searchLink={false}
        />
      </div>
    </>
  );
}
