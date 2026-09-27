// Checks for LLM-written Hebrew copy, applied after generation.

// Scripts that never belong in our Hebrew UI copy (Arabic, Cyrillic, CJK, Hangul). Haiku once
// wrote "לרقبה" (Arabic letters inside a Hebrew word) in a product title.
const FOREIGN_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

export function hasForeignScript(text: string): boolean {
  return FOREIGN_SCRIPT.test(text);
}

// Copy rules: plural, gender-neutral address (שלכם, לכם), never singular (שלך, לך, אתה).
// אתה may carry a ש/ו prefix ("מה שאתה צריך").
const SINGULAR_ADDRESS = /(^|[\s"'(־])(שלך|לך|[וש]?אתה)(?=$|[\s.,!?:;)"'])/;

export function usesSingularAddress(text: string): boolean {
  return SINGULAR_ADDRESS.test(text);
}

// A one-letter prefix glued to Latin or digits ("וQC3.0", "ב-PD") takes a maqaf.
const PREFIX_BEFORE_LATIN = /(^|[\s("])([ובלהמשכ])-?(?=[A-Za-z0-9])/g;

/**
 * Safe spelling fixes applied before the checks: a maqaf after a one-letter prefix, and the
 * Hebrew marks in abbreviations (ס"מ → ס״מ, אינץ' → אינץ׳).
 */
export function tidyHebrew(text: string): string {
  return (
    text
      .replace(PREFIX_BEFORE_LATIN, "$1$2־")
      .replace(/([א-ת])"(?=[א-ת])/g, "$1״")
      // A quoted phrase ('נגד החלקה') keeps its closing quote; any other ' after a letter is a geresh.
      .replace(/(^|[\s(])'[^'\n]+'(?![א-תA-Za-z0-9])|([א-ת])'/g, (m, _start, letter?: string) =>
        letter ? `${letter}׳` : m,
      )
  );
}

// Hebrew and Latin letters inside one word, e.g. "רשult" (seen in a real Haiku output). One
// Hebrew letter before Latin is a prefix, which tidyHebrew already separated when it could.
const MIXED_SCRIPT = /[א-ת]{2,}[A-Za-z]|[A-Za-z][א-ת]/;

export function hasMixedScript(text: string): boolean {
  return MIXED_SCRIPT.test(text);
}

/**
 * A line that is very short or lacks final punctuation was most likely cut off: under structured
 * output an ASCII " typed for gershayim ends the JSON string ("מארגן פלסטיק לסכו").
 */
export function isTruncated(text: string, minLength: number): boolean {
  return text.length < minLength || !/[.!?]$/.test(text);
}

// The card already shows the price, rounded and with ≈ when converted (CLAUDE.md §9). A second
// price in the line would disagree with it.
const PRICE =
  /₪|\$|(^|[^א-ת])(ש["״”'׳]ח|[בלו]?(שקל|שקלים|דולר|דולרים)|[בוה]?מחיר(\s+של)?\s+\d)(?=$|[^א-ת])/;

export function writesPrice(text: string): boolean {
  return PRICE.test(text);
}

export type Superlative =
  | "cheapest"
  | "most_sold"
  | "top_feedback"
  | "top_discount"
  /** "הכי טוב", "נוח ביותר", "המשתלם מבין השלושה": nothing in our data can prove it. */
  | "unverifiable";

const SUFFIX = "(?:ה|ת|ים|ות)?";
// A claim takes its scope with it ("הזול מבין השלושה"), so a scope left over belongs to a
// comparison we cannot check ("המשתלם מבין השלושה").
const claim = (forms: string) => new RegExp(`(?:${forms})(?:\\s+מבין\\s+[א-ת]+)?`, "g");
const VERIFIABLE: [Exclude<Superlative, "unverifiable">, RegExp][] = [
  [
    "cheapest",
    claim(
      `ה?זול${SUFFIX}\\s+ביותר|הזול${SUFFIX}(?![א-ת])|הכי\\s+זול${SUFFIX}|מחיר\\s+(?:הכי\\s+נמוך|הנמוך(?:\\s+ביותר)?)`,
    ),
  ],
  [
    "most_sold",
    claim(
      [
        `הנמכר${SUFFIX}(?:\\s+ביותר)?(?![א-ת])`,
        `הכי\\s+נמכר${SUFFIX}`,
        `מכירות\\s+(?:הכי\\s+גבוהות|הגבוה(?:ות)?\\s+ביותר)`,
        `הכי\\s+הרבה\\s+(?:מכירות|יחידות|קונים|נמכרו)`,
        `הכי\\s+פופולרי${SUFFIX}`,
        `הפופולרי${SUFFIX}(?:\\s+ביותר)?(?![א-ת])`,
        `רב(?:י|ת)?[\\s־-]+ה?מכר`,
      ].join("|"),
    ),
  ],
  [
    "top_feedback",
    claim(
      `(?:משוב(?:\\s+ה?חיובי)?|דירוג)\\s+(?:הכי\\s+גבוה|הגבוה\\s+ביותר)|הכי\\s+הרבה\\s+משוב(?:\\s+חיובי)?|המדורג${SUFFIX}\\s+ביותר`,
    ),
  ],
  [
    "top_discount",
    claim(
      `הנחה\\s+(?:הכי\\s+(?:גדולה|גבוהה)|ה(?:גדולה|גבוהה)\\s+ביותר)|הכי\\s+הרבה\\s+הנחה|הכי\\s+מוזל${SUFFIX}|המוזל${SUFFIX}\\s+ביותר`,
    ),
  ],
];
const ANY_SUPERLATIVE = /(^|[^א-ת])([וש]?הכי|ביותר)(?=$|[^א-ת])/;
// "מבין השלושה" or "מהאחרים" with no verifiable claim in front of it.
const ANY_COMPARISON = /(^|[^א-ת])ו?מבין(?=$|[^א-ת])|האחר(?:ים|ות)(?![א-ת])/;

/**
 * Comparative claims in a line. The caller checks each verifiable claim against the products
 * shown together; any other superlative left over is "unverifiable".
 */
export function superlativeClaims(text: string): Superlative[] {
  const claims: Superlative[] = [];
  let rest = text;
  for (const [claim, re] of VERIFIABLE) {
    if (rest.match(re)) {
      claims.push(claim);
      rest = rest.replace(re, " ");
    }
  }
  if (ANY_SUPERLATIVE.test(rest) || ANY_COMPARISON.test(rest)) claims.push("unverifiable");
  return claims;
}

/** How many products a comparison says it covers: "מבין השלושה" → 3, "מבין שני המוצרים" → 2. */
export function comparisonSizes(text: string): number[] {
  const sizes: number[] = [];
  if (/מבין\s+(?:השלושה|השלוש|שלושת|שלוש)(?![א-ת])/.test(text)) sizes.push(3);
  if (/מבין\s+(?:השניים|השתיים|שני|שתי|שניהם|שתיהן)(?![א-ת])/.test(text)) sizes.push(2);
  return sizes;
}
