// "ידעתם?" tips on the search waiting screen. Every one is a fact of the code, and the numbers
// come from the same constants the search uses, so a tip can never drift from what we do.
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { formatCount } from "@/lib/format";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";

export const WAIT_TIPS: readonly string[] = [
  // FILTERS, and FILL_TIER, which only fills up to 3 results when too few meet FILTERS.
  `כל מוצר שתראו עבר את הסינון: לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${formatCount(FILTERS.minUnitsSold)} מכירות ב־30 הימים האחרונים (או ${FILL_TIER.minPositiveFeedbackPct}% ו־${formatCount(FILL_TIER.minUnitsSold)} מכירות, כשאין מספיק מוצרים כאלה).`,
  // RESULTS_PER_PAGE, and "עוד 3 אפשרויות" when more products passed (more_available).
  `מציגים ${RESULTS_PER_PAGE} מוצרים בכל פעם, כדי שיהיה קל לבחור. אם עברו עוד, אפשר לבקש עוד ${RESULTS_PER_PAGE}.`,
  // Price and requirement chips are removable (lib/search/chips.ts).
  "את הסינונים שהבנו מהחיפוש, כמו תקציב, אפשר להסיר בלחיצה ולחפש בלעדיהם.",
  // The affiliate disclosure, and commission only breaks exact ties (lib/ranking/rank.ts).
  "אם תקנו דרך הקישורים שלנו נקבל עמלה קטנה, בלי תוספת למחיר שלכם. העמלה לא מקדמת מוצר על פני מוצר עם ציון גבוה ממנו.",
  // APPROX_PRICE_NOTE; formatIls marks a price converted from USD with ≈.
  "המחיר הסופי מוצג באלי אקספרס. מחיר שהמרנו מדולר לשקלים מסומן ב־≈.",
];
