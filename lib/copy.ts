// Fixed Hebrew strings that must read the same everywhere they appear.

/**
 * The affiliate disclosure next to every link that leaves for AliExpress through /go (buy buttons,
 * the reviews card; CLAUDE.md §1, §9). Owner decision 2026-09-28: a small "קישור שותפים" link to
 * the full text in the terms (/terms#affiliate, AFFILIATE_SECTION_ID in lib/config/legal.ts)
 * instead of the full sentence under every button. The accessible name contains the visible words.
 */
export const AFFILIATE_NOTE = {
  label: "קישור שותפים",
  ariaLabel: "מה זה קישור שותפים",
  href: "/terms#affiliate",
} as const;

export const APPROX_PRICE_NOTE = "מחיר משוער בשקלים. המחיר הסופי מוצג באלי אקספרס.";

export const BUY_LABEL = "לקנייה באלי אקספרס";

/**
 * Next to every sale date the owner entered (CLAUDE.md §1): the dates are ours to keep up to date,
 * not an AliExpress feed. On /sales, the home countdown, the holiday cards on /deals and in .ics.
 */
export const SALE_DATES_NOTE = "תאריכים לפי הודעת אלי אקספרס. אנחנו מעדכנים אותם ידנית.";

/**
 * Under the code the owner added to a big sale (deals.coupon_code of a holiday), on /sales and
 * /deals: ours, labelled "לפי תנאי הקופון", and sale codes often run out.
 */
export const SALE_CODE_NOTE =
  "קוד שהוספנו למבצע. ההנחה לפי תנאי הקופון, וחלק מהקודים מוגבלים בכמות. בדקו בקופה באלי אקספרס שההנחה התקבלה לפני התשלום.";
