// Owner details, dates and stated policies for the legal pages (/terms, /privacy, /cookies,
// /accessibility). Every statement on those pages must be true of the code as it is; this file
// holds the facts the code cannot tell (who operates the site, how to reach them) and the dates.
//
// Empty values are details the owner has not given yet. The pages never invent them: they show a
// visible "to fill" marker instead (ToFill in components/static-page.tsx), and
// lib/config/legal.test.ts lists the empty required fields as todo items on every test run.
// The public contact is an address the owner chooses for requests, not the admin sign-in email.

export interface LegalDetails {
  /** Who operates the site: the legal name of the person or company, e.g. "מצאתי בע״מ". */
  operatorName: string;
  /** Business registration number (עוסק מורשה or ח״פ), shown after the name. Optional. */
  operatorBusinessId: string;
  /** Email for privacy, terms and general requests (the pages link it with mailto:). */
  contactEmail: string;
  /**
   * Accessibility coordinator (רכז נגישות), required in the accessibility statement by the Equal
   * Rights for Persons with Disabilities (Service Accessibility) Regulations, 2013.
   */
  accessibilityCoordinatorName: string;
  /** The coordinator's phone, as it should be dialled, e.g. "03-1234567". */
  accessibilityCoordinatorPhone: string;
  /** The coordinator's email. Optional: empty means contactEmail. */
  accessibilityCoordinatorEmail: string;
}

export const LEGAL: LegalDetails = {
  operatorName: "ג׳וי רון",
  operatorBusinessId: "",
  contactEmail: "matzatiisrael@gmail.com",
  accessibilityCoordinatorName: "ג׳וי רון",
  accessibilityCoordinatorPhone: "050-5796203",
  accessibilityCoordinatorEmail: "",
};

/** The fields the pages need; the others are optional and have a fallback. */
export const REQUIRED_LEGAL_FIELDS = [
  "operatorName",
  "contactEmail",
  "accessibilityCoordinatorName",
  "accessibilityCoordinatorPhone",
] as const satisfies readonly (keyof LegalDetails)[];

/** Required fields that are still empty, in the order above. */
export function missingLegalFields(details: LegalDetails = LEGAL): (keyof LegalDetails)[] {
  return REQUIRED_LEGAL_FIELDS.filter((key) => !details[key].trim());
}

/** The accessibility contact email: the coordinator's own, else the general contact. */
export function accessibilityEmail(details: LegalDetails = LEGAL): string {
  return details.accessibilityCoordinatorEmail.trim() || details.contactEmail.trim();
}

/** The legal pages, linked from each other, the footer and the sitemap. */
export const LEGAL_PATHS = {
  terms: "/terms",
  privacy: "/privacy",
  cookies: "/cookies",
  accessibility: "/accessibility",
} as const;

export type LegalPage = keyof typeof LEGAL_PATHS;

/** Short names for links between the legal pages. */
export const LEGAL_PAGE_NAMES: Record<LegalPage, string> = {
  terms: "תקנון ותנאי שימוש",
  privacy: "מדיניות פרטיות",
  cookies: "מדיניות עוגיות",
  accessibility: "הצהרת נגישות",
};

/**
 * The section of /terms that holds the full affiliate disclosure. The small "קישור שותפים" link
 * next to every buy button (AFFILIATE_NOTE in lib/copy.ts) points here, and /disclosure redirects
 * here.
 */
export const AFFILIATE_SECTION_ID = "affiliate";

/**
 * "עודכן לאחרונה" per page (YYYY-MM-DD, Israel date). Change a page's date whenever its text
 * changes in substance.
 */
export const LEGAL_UPDATED_AT: Record<LegalPage, string> = {
  terms: "2026-10-04",
  privacy: "2026-10-03",
  cookies: "2026-10-03",
  accessibility: "2026-10-03",
};

/** The last accessibility check of the site (YYYY-MM-DD). Update it after every check. */
export const ACCESSIBILITY_CHECKED_AT = "2026-09-28";

/**
 * Retention the privacy policy states (owner decision 2026-09-28). public.run_retention()
 * (supabase/migrations/20260928200000_retention.sql, a daily pg_cron job) deletes on exactly these
 * periods; change both together (lib/config/legal.test.ts reads the migration and checks that
 * they match). The policy is true only once that migration is applied: apply it before deploying
 * /privacy.
 */
export const RETENTION = {
  /** rate_limits rows (salted IP hashes and their counters), counted from the window's end. */
  rateLimitHours: 48,
  /** search_log rows (created_at). */
  searchLogMonths: 12,
  /** clicks rows (created_at). */
  clicksMonths: 12,
  /**
   * hidden_searches rows: once both hidden_at and the last search_log row with the same
   * query_norm are older than this (search_log rows go at searchLogMonths).
   */
  hiddenSearchMonths: 12,
  /** parse_cache and search_cache rows, counted from when they were written (created_at). */
  cacheRowDays: 30,
  /** llm_usage and price_history rows: no personal data, kept for the stats and price history. */
  usageAndPricesMonths: 24,
  /**
   * whatsapp_sessions and whatsapp_seen rows (the WhatsApp bot's last search per hashed user and
   * the ids of handled messages), counted from their last write. Deleted by
   * public.run_whatsapp_retention() (20260929120000_whatsapp.sql), hourly.
   */
  whatsappHours: 48,
} as const;

const longDate = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-09-28" → "28 בספטמבר 2026". Throws on anything that is not a real YYYY-MM-DD date. */
export function formatLegalDate(isoDay: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) throw new Error(`Not a YYYY-MM-DD date: ${isoDay}`);
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDay) {
    throw new Error(`Not a real date: ${isoDay}`);
  }
  return longDate.format(date);
}
