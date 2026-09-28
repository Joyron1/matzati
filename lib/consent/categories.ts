// What the cookie notice says, in one place: the consent categories (banner and settings dialog)
// and the storage the site actually uses (for the /cookies page). Every line must stay true of the
// code: when a tool is added, list its storage here, mark its category as in use and bump
// CONSENT_VERSION (./consent.ts) so visitors are asked again.
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
      "שומרות את הבחירה שלכם בהגדרות האלה ואת ערכת הצבעים, אם בחרתם בה. בלעדיהן האתר לא יעבוד כמו שצריך.",
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

export interface StorageItem {
  /** As the browser's developer tools show it. */
  name: string;
  kind: "cookie" | "localStorage";
  category: ConsentCategory;
  /** Who gets it. */
  who: string;
  purpose: string;
  duration: string;
  /** The code that writes it (for maintainers, not shown to visitors). */
  source: string;
}

/**
 * Everything the site stores in the visitor's browser today. The site sets no analytics or
 * marketing cookies and loads no third-party scripts. Pages of AliExpress (after a buy link, or
 * the product video, which loads from AliExpress only when played) are under AliExpress's policy.
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
