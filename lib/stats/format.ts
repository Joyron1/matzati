// Display text for /admin/stats. Costs of a few calls are fractions of a cent, so small USD
// amounts keep four decimals instead of rounding to "$0.00".
import { RESULTS_FIRST_VIEW, RESULTS_PER_PAGE } from "@/lib/config/site";
import type { SearchOriginKind } from "@/lib/search/store";
import type { ClickPositionGroup } from "./report";
import type { LlmCallKind } from "./usage";

const usdSmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const usdLarge = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ilsFormat = new Intl.NumberFormat("he-IL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 0 → "$0.00", 0.01234 → "$0.0123", 12.345 → "$12.35". */
export function formatUsd(usd: number): string {
  return (Math.abs(usd) >= 1 ? usdLarge : usdSmall).format(usd);
}

/** 1234.5 → "₪1,234.50". A converted amount, so it keeps the agorot like a price would not. */
export function formatIlsAmount(ils: number): string {
  return `₪${ilsFormat.format(ils)}`;
}

/** Shown instead of a share when there is nothing to divide by (never as 0%). */
export const NO_SHARE = "אין";

/** 0.125 → "12.5%", 1 → "100%", null → NO_SHARE. */
export function formatShare(share: number | null): string {
  if (share === null || !Number.isFinite(share)) return NO_SHARE;
  const pct = Math.round(share * 1000) / 10;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

const dayFormat = new Intl.DateTimeFormat("he-IL", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  timeZone: "UTC",
});

/** An Israel date "2026-09-27" → "יום א׳, 27.9". The date is formatted as is, with no time zone shift. */
export function formatIsraelDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return dayFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

/** 6240 → "6.2 שניות", 380 → "0.4 שניות", null → NO_SHARE (nothing to measure). */
export function formatSeconds(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return NO_SHARE;
  return `${(ms / 1000).toFixed(1)} שניות`;
}

/** The "show more" button as the results page labels it. */
const MORE_BUTTON = `״עוד ${RESULTS_PER_PAGE} אפשרויות״`;

const ORIGIN_LABELS: Record<SearchOriginKind, string> = {
  typed: "הוקלד בתיבת החיפוש",
  example: "דוגמה מהאתר",
  recent: "חיפוש אחרון",
  chip: "הסרת סינון",
  sort: "שינוי מיון",
  more: MORE_BUTTON,
  preview: "עמוד SEO",
  ad: "מודעה או קמפיין",
};

/** search_log.origin in Hebrew; null is the total row. */
export function originLabel(origin: SearchOriginKind | null): string {
  return origin === null ? "סה״כ" : ORIGIN_LABELS[origin];
}

const FAILURE_LABELS: Record<string, string> = {
  parse_failed: "החיפוש לא הובן",
  upstream: "אלי אקספרס לא ענתה",
  llm: "מודל השפה לא ענה",
  capacity: "תקציב ה־LLM היומי נוצל",
  rate_limited: "מגבלת החיפושים של המבקר",
  unavailable: "תקלה אצלנו",
  invalid_query: "חיפוש לא תקין",
};

/** A search_log.failure code in Hebrew, or null for a code without a label (shown as is). */
export function failureLabel(code: string): string | null {
  return Object.hasOwn(FAILURE_LABELS, code) ? FAILURE_LABELS[code] : null;
}

// The bounds of stats_click_positions (20260930120000_ten_results.sql), which a test checks.
const POSITION_LABELS: Record<ClickPositionGroup, string> = {
  featured: "התוצאה הראשית (מקום 1)",
  first_page: `שאר התוצאות עם ״למה בחרנו״ (מקומות 2 עד ${RESULTS_PER_PAGE})`,
  first_view: `עוד אפשרויות בתצוגה הראשונה (מקומות ${RESULTS_PER_PAGE + 1} עד ${RESULTS_FIRST_VIEW})`,
  more_pages: `${MORE_BUTTON} (מקום ${RESULTS_FIRST_VIEW + 1} ומעלה)`,
};

export function clickPositionLabel(group: ClickPositionGroup): string {
  return POSITION_LABELS[group];
}

const KIND_LABELS: Record<LlmCallKind, string> = {
  parse: "הבנת החיפוש",
  explain: "הסבר לתוצאות",
  explain_more: `הסבר ל${MORE_BUTTON}`,
  titles: `שמות בעברית למקומות ${RESULTS_PER_PAGE + 1} עד ${RESULTS_FIRST_VIEW}`,
  tips: "טיפים לקטגוריה",
};

export function llmKindLabel(kind: LlmCallKind): string {
  return KIND_LABELS[kind];
}
