// "כל המוצרים" (owner request 2026-10-03): the shopping categories of /products, the header menu,
// the sitemap and llms.txt. A fixed list, so nothing a visitor or a crawler sends can make us
// fetch another AliExpress list: every category lists one first-level hot list from
// HOT_CATEGORY_IDS (lib/hot/categories.ts), or a second-level slice of one.
//
// Slugs are Hebrew, as the SEO landing pages' (/s/<slug>, lib/seo/slug.ts, isValidSlug): the
// category name in the address is what an Israeli shopper searches for, and the site is Hebrew
// only. Links and the sitemap percent-encode them (categoryPath).
//
// Left out on purpose: clothing and shoes (AliExpress sizes run small and differ per seller; the
// affiliate API gives no size table and our filters cannot check fit, so a list of them would
// promise more than we check). Weddings & Events (320) is mostly evening and wedding dresses, the
// same sizing problem, so "אירועים ומסיבות" lists Festive & Party Supplies (100001824, under Home &
// Garden) instead.
// Pure and client-safe (no zod, no server imports).
import type { HotCategoryId } from "@/lib/hot/categories";

/** Icon names, mapped to lucide icons in components/catalog-icon.tsx. */
export type CatalogIcon =
  | "electronics"
  | "phone"
  | "home"
  | "decor"
  | "appliances"
  | "computer"
  | "car"
  | "sport"
  | "beauty"
  | "jewelry"
  | "watch"
  | "bags"
  | "toys"
  | "baby"
  | "tools"
  | "lighting"
  | "events"
  | "pets";

export interface CatalogCategory {
  /**
   * Stable key: the first-level id for a whole list, the second-level id for a slice. Used in /p
   * links (`?from=hot&cat=<key>`, the format /hot used), so a link back always finds its list.
   */
  key: string;
  /** Hebrew URL slug (isValidSlug). */
  slug: string;
  /** Our Hebrew name: heading, menu, pills, breadcrumbs. */
  nameHe: string;
  icon: CatalogIcon;
  /** The first-level hot list it shows (and the category a search inside it is limited to). */
  firstLevelId: HotCategoryId;
  /**
   * A second-level slice of that list (Home Decor of Home & Garden). Unless `directFetch`, the
   * page shows the first-level list filtered to `subcategoryId`: no call of its own.
   * `directFetch` asks hotproduct.query for the second-level id itself: verified with real calls
   * on 2026-10-03 (docs/aliexpress-api.md): category_ids=3710 gave 49 products, all Home Decor (38
   * passed FILTERS), 100001824 gave 50 party supplies (47 passed), 100006664 49 pet products (41).
   */
  slice?: { subcategoryId: string; directFetch: boolean };
  /** One or two plain sentences under the heading; no number, no claim we do not check. */
  introHe: string;
}

/** In menu order: the categories Israeli AliExpress shoppers open most first. */
export const CATALOG: readonly CatalogCategory[] = [
  {
    key: "44",
    slug: "אלקטרוניקה",
    nameHe: "אלקטרוניקה",
    icon: "electronics",
    firstLevelId: "44",
    introHe: "אוזניות, רמקולים, שעונים חכמים, מצלמות וגאדג׳טים מהרשימה של אלי אקספרס.",
  },
  {
    key: "202192403",
    slug: "אביזרים-לטלפון",
    nameHe: "אביזרים לטלפון",
    icon: "phone",
    firstLevelId: "202192403",
    introHe: "כיסויים, מגני מסך, מטענים ומחזיקים לטלפון מהרשימה של אלי אקספרס.",
  },
  {
    key: "15",
    slug: "בית-ומטבח",
    nameHe: "בית ומטבח",
    icon: "home",
    firstLevelId: "15",
    introHe: "כלי מטבח, אחסון וסידור, טקסטיל, גינה ומוצרים לבית מהרשימה של אלי אקספרס.",
  },
  {
    key: "3710",
    slug: "עיצוב-ואביזרי-נוי",
    nameHe: "עיצוב ואביזרי נוי",
    icon: "decor",
    firstLevelId: "15",
    slice: { subcategoryId: "3710", directFetch: true },
    introHe: "אביזרי נוי ועיצוב לבית, מתוך הרשימה של אלי אקספרס לבית ולגינה.",
  },
  {
    key: "6",
    slug: "מכשירי-חשמל-לבית",
    nameHe: "מכשירי חשמל לבית",
    icon: "appliances",
    firstLevelId: "6",
    introHe: "מכשירי חשמל למטבח, לניקוי ולטיפוח אישי מהרשימה של אלי אקספרס.",
  },
  {
    key: "7",
    slug: "מחשבים-ומשרד",
    nameHe: "מחשבים ומשרד",
    icon: "computer",
    firstLevelId: "7",
    introHe: "ציוד היקפי, אביזרים למחשב ולטאבלט, אחסון וציוד משרדי מהרשימה של אלי אקספרס.",
  },
  {
    key: "34",
    slug: "רכב",
    nameHe: "רכב",
    icon: "car",
    firstLevelId: "34",
    introHe: "אביזרים לרכב, אלקטרוניקה, תאורה ומוצרי ניקוי ותחזוקה מהרשימה של אלי אקספרס.",
  },
  {
    key: "18",
    slug: "ספורט-ופנאי",
    nameHe: "ציוד ספורט ופנאי",
    icon: "sport",
    firstLevelId: "18",
    introHe: "ציוד כושר, רכיבה, קמפינג, דיג ופנאי מהרשימה של אלי אקספרס.",
  },
  {
    key: "66",
    slug: "יופי-וטיפוח",
    nameHe: "יופי וטיפוח",
    icon: "beauty",
    firstLevelId: "66",
    introHe: "טיפוח העור והשיער, איפור, ציפורניים ומכשירי יופי מהרשימה של אלי אקספרס.",
  },
  {
    key: "36",
    slug: "תכשיטים",
    nameHe: "תכשיטים",
    icon: "jewelry",
    firstLevelId: "36",
    introHe: "שרשראות, עגילים, צמידים וטבעות מהרשימה של אלי אקספרס.",
  },
  {
    key: "1511",
    slug: "שעונים",
    nameHe: "שעונים",
    icon: "watch",
    firstLevelId: "1511",
    introHe: "שעוני יד לגברים, לנשים ולילדים, ואביזרים לשעונים, מהרשימה של אלי אקספרס.",
  },
  {
    key: "1524",
    slug: "תיקים-ומזוודות",
    nameHe: "תיקים ומזוודות",
    icon: "bags",
    firstLevelId: "1524",
    introHe: "תיקים, תרמילים, ארנקים, מזוודות ואביזרי נסיעות מהרשימה של אלי אקספרס.",
  },
  {
    key: "26",
    slug: "צעצועים",
    nameHe: "צעצועים ומשחקי ילדים",
    icon: "toys",
    firstLevelId: "26",
    introHe: "משחקי בנייה, פאזלים, בובות, צעצועים על שלט ומשחקי חוץ מהרשימה של אלי אקספרס.",
  },
  {
    key: "1501",
    slug: "אמא-ותינוק",
    nameHe: "אמא ותינוק",
    icon: "baby",
    firstLevelId: "1501",
    introHe: "האכלה, טיפוח, בטיחות, ציוד לתינוק ובגדי ילדים מהרשימה של אלי אקספרס.",
  },
  {
    key: "1420",
    slug: "כלי-עבודה",
    nameHe: "כלי עבודה",
    icon: "tools",
    firstLevelId: "1420",
    introHe: "כלים חשמליים וידניים, ערכות כלים ומכשירי מדידה מהרשימה של אלי אקספרס.",
  },
  {
    key: "39",
    slug: "תאורה",
    nameHe: "תאורה",
    icon: "lighting",
    firstLevelId: "39",
    introHe: "תאורת לד, תאורה לבית ולחוץ, מנורות לילה ותאורה חכמה מהרשימה של אלי אקספרס.",
  },
  {
    key: "100001824",
    slug: "אירועים-ומסיבות",
    nameHe: "אירועים ומסיבות",
    icon: "events",
    firstLevelId: "15",
    slice: { subcategoryId: "100001824", directFetch: true },
    introHe: "בלונים, קישוטים ואביזרים למסיבות ולימי הולדת מהרשימה של אלי אקספרס.",
  },
  {
    key: "100006664",
    slug: "חיות-מחמד",
    nameHe: "חיות מחמד",
    icon: "pets",
    firstLevelId: "15",
    slice: { subcategoryId: "100006664", directFetch: true },
    introHe: "צעצועים, מיטות, רצועות וכלי האכלה לכלבים ולחתולים מהרשימה של אלי אקספרס.",
  },
];

/** The category of a URL slug (decoded), or null. */
export function catalogBySlug(slug: string): CatalogCategory | null {
  return CATALOG.find((c) => c.slug === slug) ?? null;
}

/** The category of a key (`?cat=` of a /p link), or null. */
export function catalogByKey(key: string): CatalogCategory | null {
  return CATALOG.find((c) => c.key === key) ?? null;
}

/**
 * The whole-list category of a first-level id (not a slice), or null: where an old /hot?cat=<id>
 * link and a search limited to that id point.
 */
export function catalogByFirstLevel(id: string): CatalogCategory | null {
  return CATALOG.find((c) => c.firstLevelId === id && !c.slice) ?? null;
}

/** "תכשיטים מאלי אקספרס שעברו סינון": the page title (the tab and the preview add " | מצאתי"). */
export function categoryTitle(category: Pick<CatalogCategory, "nameHe">): string {
  return `${category.nameHe} מאלי אקספרס שעברו סינון`;
}

/** Public path of a category page, percent-encoded so it is a valid URL in links and the sitemap. */
export function categoryPath(c: Pick<CatalogCategory, "slug">): string {
  return `/products/${encodeURIComponent(c.slug)}`;
}

/** The id its hot list is fetched with: the slice's own id only once directFetch is verified. */
export function catalogFetchId(c: CatalogCategory): string {
  return c.slice?.directFetch ? c.slice.subcategoryId : c.firstLevelId;
}

/**
 * Second-level ids fetched directly (slices with directFetch on). lib/hot/categories.ts adds them
 * to the ids the hot loader may ever fetch; empty until the lead verifies the call.
 */
export const DIRECT_FETCH_IDS: readonly string[] = CATALOG.flatMap((c) =>
  c.slice?.directFetch ? [c.slice.subcategoryId] : [],
);

/** "חיפוש בתכשיטים": the category a search inside it is limited to (its first-level list). */
export function searchCategoryName(firstLevelId: string): string | null {
  return catalogByFirstLevel(firstLevelId)?.nameHe ?? null;
}
