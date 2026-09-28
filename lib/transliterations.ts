// English title words the explain step sometimes writes in Hebrew letters ("מיטת כלב עגולה פלוש",
// "plush"), and the Hebrew each becomes. Applied to new Hebrew titles by the explain post-checks
// (lib/llm/explain.ts) and, for titles already cached, where our Hebrew titles are read for
// display (toResultProduct, productTitleView, recent-search photos, /coupons), so a cached title
// is fixed without a cache bump. Pure, and idempotent: no replacement contains a word of the
// table. Keep the table small and sure: every entry rewrites copy other shoppers see.
//
// Replacements are grammar-neutral phrases ("מפרווה רכה", "בעיצוב מתקפל"), so they read right
// after a noun of either gender or number: "מיטת כלב מפרווה רכה", "בובת Sonic מפרווה רכה".
// AliExpress's own Hebrew machine translations (hot lists) go through it too where they are shown
// (hotTitle in lib/product-title.ts; owner decision 2026-09-28), without an English title, so a
// spelling marked needsEnglish is left alone there; the pages still say they are machine
// translations.

interface Transliteration {
  /** The Hebrew spellings, as whole words. */
  words: readonly string[];
  /** The English word they stand for, as AliExpress titles write it. */
  en: RegExp;
  /** What they become. */
  he: string;
  /**
   * Only when the English title has `en`: the spelling is also a Hebrew word or another loan word
   * ("פלאש" is also a camera flash or a flash drive). Without the English title, left alone.
   */
  needsEnglish?: boolean;
  /**
   * One-letter prefixes the word may carry. A phrase that starts with its own preposition
   * ("מפרווה רכה") takes only ו: "בפלוש" would become "במפרווה רכה", so it is left alone.
   */
  prefixes: string;
}

const PHRASE = "ו";
const NOUN = "ובלהמש";

export const TRANSLITERATIONS: readonly Transliteration[] = [
  // Live site 2026-09-28: "מיטת כלב עגולה פלוש חמה לחורף", "בובת Sonic פלוש 30 ס״מ".
  { words: ["פלוש"], en: /plush/i, he: "מפרווה רכה", prefixes: PHRASE },
  { words: ["פלאש"], en: /plush/i, he: "מפרווה רכה", needsEnglish: true, prefixes: PHRASE },
  // "מיטת כלב פלאפי עם בסיס נגד החלקה" (live site): fluffy, on a plush product only (fluffy
  // eyelashes are not fur).
  {
    words: ["פלאפי", "פלאפית", "פלאפיים", "פלאפיות"],
    en: /plush/i,
    he: "מפרווה רכה",
    needsEnglish: true,
    prefixes: PHRASE,
  },
  // "2 בסיסים אוניברסליים לסאונד בר וספיקרים" (live site).
  { words: ["ספיקר"], en: /speaker/i, he: "רמקול", prefixes: NOUN },
  { words: ["ספיקרים"], en: /speaker/i, he: "רמקולים", prefixes: NOUN },
  // "אוזניות ספורט K58 Bluetooth נקבנד עם מיקרופון" (eval fixtures).
  { words: ["נקבנד", "נקבאנד"], en: /neck\s*band/i, he: "עם רצועת צוואר", prefixes: PHRASE },
  // "מארגן ביגוד קולפסיבילי 1/2/3 חלקים" (live site; new titles with it were rejected).
  {
    words: ["קולפסיבילי", "קולפסיבילית", "קולפסיביליים", "קולפסיביליות"],
    en: /collaps/i,
    he: "בעיצוב מתקפל",
    prefixes: PHRASE,
  },
  // Seller words written the same way (AliExpress's own Hebrew titles have some of them).
  {
    words: ["אנטי סליפ", "אנטי־סליפ", "אנטי-סליפ", "נון סליפ"],
    en: /slip/i,
    he: "נגד החלקה",
    prefixes: PHRASE,
  },
  { words: ["ווטרפרוף", "ווטרפרופ"], en: /waterproof/i, he: "עם עמידות למים", prefixes: PHRASE },
  { words: ["וויירלס", "ווירלס"], en: /wireless/i, he: "בחיבור אלחוטי", prefixes: PHRASE },
  { words: ["פולדבל", "פולדינג"], en: /fold/i, he: "בעיצוב מתקפל", prefixes: PHRASE },
];

const HEBREW_LETTER = "א-ת";

const compiled = TRANSLITERATIONS.map((t) => ({
  ...t,
  // A whole word after the allowed prefixes: not inside a longer Hebrew word, and not before a
  // geresh or gershayim that makes it an abbreviation.
  re: new RegExp(
    `(^|[^${HEBREW_LETTER}])([${t.prefixes}]?)(?:${t.words.join("|")})(?![${HEBREW_LETTER}׳״'"])`,
    "g",
  ),
}));

/**
 * `text` (one of our Hebrew titles) with the known transliterations replaced (TRANSLITERATIONS).
 * `titleEn`, when known, is the product's English title: a spelling that also means something
 * else is replaced only when the English title has the word it stands for.
 */
export function fixTransliterations(text: string, titleEn?: string | null): string {
  let out = text;
  for (const t of compiled) {
    if (t.needsEnglish && !(titleEn && t.en.test(titleEn))) continue;
    out = out.replace(t.re, (_m, start: string, prefix: string) => `${start}${prefix}${t.he}`);
  }
  return out === text ? text : out.replace(/\s{2,}/g, " ").trim();
}
