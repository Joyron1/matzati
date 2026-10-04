// What the cookie notice says, in one place: the consent categories (banner and settings dialog)
// and the storage the site actually uses (for the /cookies page). Every line must stay true of the
// code: when a tool is added, list its storage here, mark its category as in use and bump
// CONSENT_VERSION (./consent.ts) so visitors are asked again.
//
// Google Analytics is on only while the owner has set its measurement id (/admin/settings): the
// pages then use consentCategories(true, …) and storageInventory(id, …), and the notice version
// changes on its own (consentNotice in ./consent.ts). It measures every visitor without cookies and
// sets its cookies only with consent (Consent Mode "advanced", components/analytics/gtag.ts). The
// Meta Pixel likewise, while the owner has set its pixel id: consentCategories(…, true) and
// storageInventory(…, pixelId); it runs only after marketing consent (components/analytics/
// meta-pixel.tsx, app/go/[productId]/route.ts). CONSENT_CATEGORIES and STORAGE_INVENTORY are the
// site without either.
import type { ConsentCategory } from "./consent";

export interface ConsentCategoryInfo {
  id: ConsentCategory;
  label: string;
  description: string;
  /** False: nothing on the site uses this category today (shown as "לא בשימוש כרגע"). */
  inUse: boolean;
}

export const CONSENT_CATEGORIES: readonly ConsentCategoryInfo[] = [
  {
    id: "necessary",
    label: "הכרחיות",
    description:
      "שומרות את הבחירה שלכם בהגדרות האלה, את ערכת הצבעים אם בחרתם בה, ואת החיפושים האחרונים שלכם, רק בדפדפן שלכם. בלעדיהן האתר לא יעבוד כמו שצריך.",
    inUse: true,
  },
  {
    id: "analytics",
    label: "סטטיסטיקה",
    description: "מדידת השימוש באתר, כדי להבין מה עובד ומה כדאי לשפר.",
    inUse: false,
  },
  {
    id: "marketing",
    label: "שיווק",
    description: "פרסום ומדידה של קמפיינים.",
    inUse: false,
  },
];

/**
 * The statistics category while Google Analytics is configured, in Consent Mode "advanced"
 * (components/analytics/gtag.ts): cookieless measurement for everyone, the _ga cookies only with
 * consent. Changing what this says means bumping ANALYTICS_NOTICE_REVISION (./consent.ts).
 */
const ANALYTICS_IN_USE: ConsentCategoryInfo = {
  id: "analytics",
  label: "סטטיסטיקה",
  description:
    "מדידת השימוש באתר עם Google Analytics, כדי להבין מה עובד ומה כדאי לשפר. גם בלי אישור, Google מקבלת מכל עמוד נתוני שימוש בלי עוגיות ובלי מזהה קבוע. אם תאשרו, יישמרו בדפדפן גם עוגיות של Google Analytics עם מזהה אקראי, כדי להבחין בין מבקרים חדשים לחוזרים.",
  inUse: true,
};

/**
 * The marketing category while the Meta Pixel is configured (components/analytics/meta-pixel.tsx
 * and the buy-click page of app/go/[productId]/route.ts): nothing before consent, no advanced
 * matching. Changing what this says means bumping MARKETING_NOTICE_REVISION (./consent.ts).
 */
const MARKETING_IN_USE: ConsentCategoryInfo = {
  id: "marketing",
  label: "שיווק",
  description:
    "מדידה ופרסום של המודעות שלנו בפייסבוק ובאינסטגרם עם Meta Pixel של Meta. רק אם תאשרו, Meta תקבל מהדפדפן שלכם את העמודים שבהם ביקרתם (בלי טקסט החיפוש) ואת הלחיצות לקנייה באלי אקספרס, ותישמר בדפדפן עוגייה של Meta עם מזהה אקראי, כדי למדוד אם ביקור הגיע ממודעה ולהציג את המודעות שלנו לקהלים מתאימים. בלי אישור לא נשלח ל־Meta דבר.",
  inUse: true,
};

/** The categories the banner, the settings dialog and /cookies show. */
export function consentCategories(
  analyticsInUse: boolean,
  marketingInUse: boolean,
): readonly ConsentCategoryInfo[] {
  if (!analyticsInUse && !marketingInUse) return CONSENT_CATEGORIES;
  return CONSENT_CATEGORIES.map((c) =>
    c.id === "analytics" && analyticsInUse
      ? ANALYTICS_IN_USE
      : c.id === "marketing" && marketingInUse
        ? MARKETING_IN_USE
        : c,
  );
}

export interface StorageItem {
  /** As the browser's developer tools show it. */
  name: string;
  kind: "cookie" | "localStorage";
  category: ConsentCategory;
  /** Who gets it. */
  who: string;
  purpose: string;
  duration: string;
  /** A third party that receives what it holds; unset for the site's own storage. */
  provider?: string;
  /**
   * Set on another site's domain, not ours (the site neither writes nor reads it): shown as such on
   * /cookies. Unset for storage on the site's own domain.
   */
  thirdPartyDomain?: string;
  /** The code that writes it (for maintainers, not shown to visitors). */
  source: string;
}

/**
 * Everything the site stores in the visitor's browser without Google Analytics and the Meta Pixel
 * (storageInventory adds their cookies while they are configured). Apart from it, the site sets no analytics or
 * marketing cookies and loads no third-party scripts. Pages of AliExpress (after a buy link) and
 * the product video (loaded from AliExpress's video host when a product page with a video opens,
 * where it plays muted unless the visitor asked for reduced motion or to save data) are under
 * AliExpress's policy.
 */
export const STORAGE_INVENTORY: readonly StorageItem[] = [
  {
    name: "matzati_consent",
    kind: "cookie",
    category: "necessary",
    who: "מי שבחר בהודעת העוגיות",
    purpose: "שומרת את הבחירה שלכם בהודעת העוגיות, כדי שלא נשאל שוב בכל עמוד.",
    duration: "12 חודשים",
    source: "lib/consent/store.ts",
  },
  {
    name: "theme",
    kind: "localStorage",
    category: "necessary",
    who: "מי שבחר מצב בהיר או כהה בכפתור שבראש העמוד",
    purpose: "זוכר את ערכת הצבעים שבחרתם.",
    duration: "עד שתמחקו את נתוני האתר בדפדפן",
    source: "components/theme-provider.tsx (next-themes)",
  },
  {
    // lib/recent/mine.ts: {q, at} per search, newest first, at most MY_SEARCHES_MAX (12).
    name: "matzati_my_searches",
    kind: "localStorage",
    category: "necessary",
    who: "מי שחיפש באתר",
    purpose:
      "זוכר את 12 החיפושים האחרונים שלכם (הטקסט והשעה), כדי להציג לכם אותם תחת ״החיפושים שלי״ בעמוד הבית ובעמוד החיפושים האחרונים. נשמר רק בדפדפן שלכם: הוא לא נשלח אלינו ולא לאף אחד אחר, ואחרים לא רואים אותו. אפשר להסיר חיפוש בכפתור ה־× שלו, או את כולם בכפתור ״ניקוי״.",
    duration: "עד שתנקו אותו בכפתור ״ניקוי״ או תמחקו את נתוני האתר בדפדפן",
    source: "lib/recent/mine.ts, components/my-searches.tsx",
  },
  {
    name: "sb-…-auth-token",
    kind: "cookie",
    category: "necessary",
    who: "מנהלי האתר בלבד, בממשק הניהול",
    purpose: "שומרת את ההתחברות לממשק הניהול.",
    duration: "עד היציאה מממשק הניהול, ולכל היותר 400 ימים",
    source: "proxy.ts, lib/supabase/ssr.ts (@supabase/ssr)",
  },
  {
    // PKCE verifiers @supabase/auth-js writes when a magic link is requested, for every address
    // (lib/admin/rules.ts decoyAuthFetch): `${storageKey}-code-verifier` plus a slot per request
    // (`-flow-<id>-code-verifier`) and their index (`-flows-code-verifier`), storageKey being
    // `sb-<ref>-auth-token` (@supabase/auth-js lib/helpers.js storePKCEVerifier). Removed after the code
    // exchange and on sign-out (removeAllPKCEVerifiers); @supabase/ssr's cookie maxAge is 400 days.
    name: "sb-…-auth-token-code-verifier",
    kind: "cookie",
    category: "necessary",
    who: "מי שמבקש קישור כניסה בעמוד הכניסה לממשק הניהול",
    purpose:
      "מוודאות שקישור הכניסה נפתח באותו דפדפן שביקש אותו. לכל בקשת קישור נשמרת עוגייה כזו, ששמה מסתיים ב־code-verifier.",
    duration: "נמחקות בסיום הכניסה או ביציאה, ולכל היותר 400 ימים",
    source: "app/(admin-public)/admin/login/actions.ts (@supabase/ssr)",
  },
];

/**
 * The cookies Google Analytics 4 sets once the visitor accepts statistics
 * (components/analytics/gtag.ts: host-only, cookie_expires 2 years, renewed on each visit; deleted
 * when the consent is withdrawn). `_ga_<container>` is named after the measurement id without "G-".
 */
export function analyticsStorage(measurementId: string): StorageItem[] {
  const who = "מי שאישר עוגיות סטטיסטיקה";
  const provider = "Google (Google Analytics)";
  const duration = "שנתיים מהביקור האחרון, או עד שתבטלו את ההסכמה";
  const source = "components/analytics/gtag.ts (gtag.js)";
  return [
    {
      name: "_ga",
      kind: "cookie",
      category: "analytics",
      who,
      purpose:
        "מזהה אקראי של הדפדפן, כדי ש־Google Analytics יבחין בין מבקרים חדשים לחוזרים ויספור ביקורים.",
      duration,
      provider,
      source,
    },
    {
      name: `_ga_${measurementId.replace(/^G-/, "")}`,
      kind: "cookie",
      category: "analytics",
      who,
      purpose: "שומרת את מצב הביקור הנוכחי (מתי התחיל ומספר הביקור), כדי למדוד ביקורים ומשכם.",
      duration,
      provider,
      source,
    },
  ];
}

/**
 * The Meta Pixel's storage once the visitor accepts marketing (components/analytics/meta-pixel.tsx):
 * fbevents.js writes the first-party `_fbp` (90 days, renewed on each visit) and, after a click with
 * fbclid, `_fbc`; both are deleted when the consent is withdrawn and on every page without it. Meta may also read its own cookies on its own
 * domain (such as `fr` on facebook.com) when the pixel's requests reach it: listed, marked as Meta's
 * domain, because the visitor's browser sends them, but the site neither sets nor reads them.
 */
export function marketingStorage(): StorageItem[] {
  const who = "מי שאישר עוגיות שיווק";
  const provider = "Meta Platforms (Meta Pixel)";
  return [
    {
      name: "_fbp",
      kind: "cookie",
      category: "marketing",
      who,
      purpose:
        "מזהה אקראי של הדפדפן שמאפשר ל־Meta למדוד אם ביקור באתר הגיע ממודעה ולבנות קהלים לפרסום.",
      duration: "90 יום מהביקור האחרון, או עד שתבטלו את ההסכמה",
      provider,
      source: "components/analytics/meta-pixel.tsx (fbevents.js)",
    },
    {
      // fbevents.js writes it when the page address has fbclid (META_ALLOWED_PARAMS keeps it).
      name: "_fbc",
      kind: "cookie",
      category: "marketing",
      who: "מי שאישר עוגיות שיווק והגיע לאתר מלחיצה על מודעה או על קישור בפייסבוק או באינסטגרם",
      purpose:
        "שומרת את מזהה הלחיצה שפייסבוק ואינסטגרם מוסיפות לכתובת (fbclid), כדי ש־Meta תדע שהביקור הגיע מלחיצה אצלה.",
      duration: "90 יום מהביקור האחרון, או עד שתבטלו את ההסכמה",
      provider,
      source: "components/analytics/meta-pixel.tsx (fbevents.js)",
    },
    {
      name: "fr",
      kind: "cookie",
      category: "marketing",
      who: "מי שאישר עוגיות שיווק ומחובר לפייסבוק או לאינסטגרם בדפדפן הזה, או ביקר בהם",
      purpose:
        "עוגייה של Meta בדומיין שלה (facebook.com), לא בדומיין של האתר. כשהפיקסל שולח נתונים ל־Meta, הדפדפן שולח לה גם את העוגיות שלה, ו־Meta עשויה להשתמש בהן כדי לקשר את הביקור לחשבון ולהציג מודעות. אנחנו לא שומרים ולא קוראים אותה.",
      duration: "לפי מדיניות העוגיות של Meta",
      provider,
      thirdPartyDomain: "facebook.com",
      source: "fbevents.js requests to facebook.com (Meta's own cookie, not ours)",
    },
  ];
}

/**
 * Everything the site stores in the browser, with Google Analytics's cookies while it is set and
 * the Meta Pixel's while its id is set.
 */
export function storageInventory(
  measurementId: string | null,
  metaPixelId: string | null,
): readonly StorageItem[] {
  if (!measurementId && !metaPixelId) return STORAGE_INVENTORY;
  return [
    ...STORAGE_INVENTORY,
    ...(measurementId ? analyticsStorage(measurementId) : []),
    ...(metaPixelId ? marketingStorage() : []),
  ];
}
