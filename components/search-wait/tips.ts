// "ידעתם?" tips on the search waiting screen. Every one is a fact of the code, and the numbers
// come from the same constants the search uses, so a tip can never drift from what we do.
import { MORE_STEP, RESULTS_FIRST_VIEW, RESULTS_PER_PAGE } from "@/lib/config/site";
import { formatCount } from "@/lib/format";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";

export const WAIT_TIPS: readonly string[] = [
  // The tiers in the order a search shows them (rankForSearch, exact first, 2026-10-04).
  `קודם מה שעבר את הסינון: לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${formatCount(FILTERS.minUnitsSold)} מכירות ב־30 הימים האחרונים (או ${FILL_TIER.minPositiveFeedbackPct}% ו־${formatCount(FILL_TIER.minUnitsSold)} מכירות). אחריהם מוצרים פחות מוכחים.`,
  // RESULTS_FIRST_VIEW (the explained page and places 6-10), and "עוד N אפשרויות" when more
  // products passed (more_after_first_view).
  `מציגים קודם ${RESULTS_FIRST_VIEW} מוצרים, ול־${RESULTS_PER_PAGE} הראשונים כותבים למה בחרנו. אם יש עוד, אפשר לטעון עוד ${MORE_STEP} בכל פעם.`,
  // Price and requirement chips are removable (lib/search/chips.ts).
  "את הסינונים שהבנו מהחיפוש, כמו תקציב, אפשר להסיר בלחיצה ולחפש בלעדיהם.",
  // The order (lib/ranking/rank.ts); the affiliate disclosure itself lives in /terms#affiliate.
  "הסדר נקבע לפי משוב של קונים, מכירות, מחיר והתאמה למה שחיפשתם.",
  // APPROX_PRICE_NOTE; formatIls marks a price converted from USD with ≈.
  "המחיר הסופי מוצג באלי אקספרס. מחיר שהמרנו מדולר לשקלים מסומן ב־≈.",
];
