// Hebrew notes shared by the home carousel, /hot, /p and /coupons.
import { FILTERS } from "@/lib/ranking/config";

/** Our thresholds, read from FILTERS so the numbers shown match the ones applied. */
export const HOT_FILTER_NOTE = `מוצגים רק מוצרים עם לפחות ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ו־${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים.`;

/** The titles come from AliExpress in Hebrew: its machine translation, shown unchanged. */
export const HOT_TITLES_NOTE = "שמות המוצרים בתרגום אוטומטי של אלי אקספרס.";

/** /coupons when only some of the titles are AliExpress's machine translation. */
export const SOME_TITLES_NOTE = "חלק משמות המוצרים בתרגום אוטומטי של אלי אקספרס.";

/** /p under a heading that is AliExpress's machine translation (lib/product-title.ts). */
export const PRODUCT_TITLE_NOTE = "שם המוצר בתרגום אוטומטי של אלי אקספרס.";
