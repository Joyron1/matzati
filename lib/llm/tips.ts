// Job (c): generic Hebrew buying tips per AliExpress product category (CLAUDE.md §2), cached in
// category_tips (lib/tips/store.ts). The model sees only category names, never a product, a query
// or a shopper, so a tip can only be generic. Every tip is post-checked in code.
import { z } from "zod";
import type { LlmProvider, LlmUsage } from "./provider";
import {
  hasForeignScript,
  hasMixedScript,
  isTruncated,
  superlativeClaims,
  tidyHebrew,
  usesSingularAddress,
  writesPrice,
} from "./text-checks";

/** Stored with every entry: bump it whenever the prompt or the checks change (older entries go stale). */
export const TIPS_VERSION = 1;

export const TIP_MAX = 140;
export const TIP_MIN = 20;
/** Fewer surviving tips than this and the category gets no tips section at all. */
export const MIN_TIPS = 2;
export const MAX_TIPS = 5;

/** The whole model input: AliExpress category names (English), nothing else. */
export interface TipsInput {
  /** The category the tips are for (second level when the product has one). */
  category: string;
  /** Its first-level parent, when `category` is a second-level category. */
  parent_category: string | null;
}

// Counts are not enforced in the schema: the SDK validates client-side and would throw on a
// sixth tip. checkTips() caps the list instead.
export const tipsSchema = z.object({
  tips: z
    .array(z.string().describe("One short Hebrew sentence ending with a period"))
    .describe("3-5 generic buying tips for the category"),
});

export const TIPS_SYSTEM = `You write short, generic buying tips in Hebrew for an Israeli site that helps shoppers buy on AliExpress. The input JSON names one AliExpress product category in English ("category", plus "parent_category" when it has one). You know nothing about any specific product, seller or shopper, and you must not pretend to.

Return 3 to 5 tips in "tips". Each tip:
- is one complete Hebrew sentence of at most ${TIP_MAX} characters, ending with a period;
- tells shoppers what to check before buying this kind of item online: specs to compare in the listing, compatibility, sizes and measurements, materials, safety marks, what is included in the package;
- is generic and true for most items in the category. If the category is broad, give tips that fit most items in it;
- never mentions a brand, a store, a model name, a price, a discount, a coupon or a delivery time, and never describes or recommends a specific product;
- has no statistics, percentages, counts or durations, and no claims about what most buyers do or think. The only digits allowed are inside technical standard names written in Latin letters, such as IPX7, IP67, USB-C, Bluetooth 5.0 or 65W;
- says what to check, not what is best: no superlatives such as "הכי טוב" or "ביותר", no promises, no warnings you cannot back up.

Hebrew style:
- Plural, gender-neutral imperative and address: "בדקו", "חפשו", "השוו", "שימו לב", "שלכם", "לכם". Never "בדוק", "שלך", "לך", "אתה".
- Natural Israeli Hebrew, not word-for-word translation. Hebrew letters only; Latin letters only for technical standards like the ones above. Put a maqaf between a one-letter Hebrew prefix and Latin letters: "ב־USB-C".
- In abbreviations use the Hebrew marks ״ and ׳, never the ASCII characters " or ': "ס״מ", "מ״ל", "ק״ג".
- No emoji, no exclamation marks.

Examples:
{"category":"Mobile Phone Cases & Covers","parent_category":"Phones & Telecommunications Accessories"} -> {"tips":["בדקו שהכיסוי מיועד בדיוק לדגם הטלפון שלכם, כי גם הבדל קטן בין דגמים משנה את מיקום המצלמה והכפתורים.","אם אתם טוענים בלי חוטים, ודאו שבמודעה כתוב שהכיסוי תומך בטעינה אלחוטית.","השוו את החומר: סיליקון רך נוח לאחיזה, וכיסוי עם שוליים מוגבהים מגן יותר על המסך ועל המצלמה."]}
{"category":"Camping & Hiking","parent_category":"Sports & Entertainment"} -> {"tips":["בדקו במודעה את המשקל ואת המידות כשהציוד מקופל, במיוחד אם תסחבו אותו בתרמיל.","לציוד שנשאר בחוץ חפשו עמידות למים לפי תקן מוגדר, כמו IPX4 או IP67, ולא רק את המילה עמיד.","קראו מה כלול באריזה, כי לפעמים התמונות מציגות גם אביזרים שנמכרים בנפרד."]}`;

export type TipProblem =
  | "empty"
  | "truncated"
  | "too_long"
  | "foreign_script"
  | "mixed_script"
  | "singular_address"
  | "price_written"
  | "number"
  | "claim"
  | "latin_word"
  | "duplicate";

// A Latin standard name followed by a version: "Bluetooth 5.0", "USB 3.0", "Wi-Fi 6". A version
// has at most two digits before its point, and the number must end there, so "LED 100",
// "USB 100%" or "USB 1,000" still leave a standalone number behind.
const VERSIONED_STANDARD =
  /(?<![A-Za-z0-9])[A-Za-z][A-Za-z-]*[A-Za-z]\s\d{1,2}(?:\.\d+)?(?![\d%]|[.,]\d)/g;
// A run of Latin letters and digits, joined by - + . or / only between two of them:
// "IPX7", "USB-C", "5V/2A", "2.4GHz", "3.5mm", but "100" in "100%" and "1-2" stand alone.
const LATIN_RUN = /[A-Za-z0-9](?:[A-Za-z0-9]|[-+./](?=[A-Za-z0-9]))*/g;

/**
 * True when the tip has a number that is not part of a Latin spec token ("3 שנים", "90%",
 * "ל־30 יום"). Spec tokens like IPX7, 65W, USB-C or Bluetooth 5.0 are fine.
 */
export function hasStandaloneNumber(text: string): boolean {
  const rest = text.replace(VERSIONED_STANDARD, " ");
  return (rest.match(LATIN_RUN) ?? []).some((run) => /\d/.test(run) && !/[A-Za-z]/.test(run));
}

// Latin is for technical standards only. Acronyms (USB-C, HDMI, BPA) and tokens with digits
// (IPX7, 65W) pass; any other Latin word is most likely a brand or product name ("Anker",
// "Oral-B", "iPhone") unless it is one of these standards.
const STANDARD_WORDS = new Set([
  "bluetooth",
  "wi-fi",
  "wifi",
  "type-c",
  "micro-usb",
  "mini-usb",
  "lightning",
  "mah",
  "hz",
  "khz",
  "mhz",
  "ghz",
  "gan",
  "qi",
]);

export function hasBrandLikeWord(text: string): boolean {
  return (text.match(LATIN_RUN) ?? []).some(
    (w) =>
      /[A-Za-z]/.test(w) &&
      !/\d/.test(w) &&
      w !== w.toUpperCase() &&
      !STANDARD_WORDS.has(w.toLowerCase()),
  );
}

// What buyers do or think ("רוב הקונים מעדיפים", "לקוחות רבים"): a statistic in words, which
// nothing in a category-level tip can back up.
const BUYER_CLAIM =
  /(?:^|[^א-ת])[וש]?(?:ב?רוב|מרבית|רבים\s+מ|חלק\s+מ|הרבה)\s*ה?(?:קונים|לקוחות|משתמשים|צרכנים|אנשים)(?![א-ת])|(?:^|[^א-ת])[וש]?(?:קונים|לקוחות|משתמשים|צרכנים)\s+רבים(?![א-ת])/;

/**
 * True when the tip makes a claim no generic tip can back up: a superlative or comparison
 * ("הכי טוב", "החזק ביותר", "הזול"; CLAUDE.md §9) or a statistic about buyers in words.
 */
export function makesUnverifiableClaim(text: string): boolean {
  return superlativeClaims(text).length > 0 || BUYER_CLAIM.test(text);
}

/** The first problem with one (tidied) tip, or null when it may be shown. */
export function tipProblem(tip: string): TipProblem | null {
  if (!tip) return "empty";
  if (isTruncated(tip, TIP_MIN)) return "truncated";
  if (tip.length > TIP_MAX) return "too_long";
  if (hasForeignScript(tip)) return "foreign_script";
  if (hasMixedScript(tip)) return "mixed_script";
  if (usesSingularAddress(tip)) return "singular_address";
  if (writesPrice(tip)) return "price_written";
  if (hasStandaloneNumber(tip)) return "number";
  if (makesUnverifiableClaim(tip)) return "claim";
  if (hasBrandLikeWord(tip)) return "latin_word";
  return null;
}

export interface CheckedTips {
  /** Tips that passed, tidied, in the model's order, at most MAX_TIPS. */
  tips: string[];
  /** For logs only, never shown. */
  rejected: { tip: string; problem: TipProblem }[];
}

/** Drops every tip that fails a check (and repeats); the rest keep their order. */
export function checkTips(raw: readonly string[]): CheckedTips {
  const tips: string[] = [];
  const rejected: CheckedTips["rejected"] = [];
  for (const original of raw) {
    const tip = tidyHebrew(original.trim().replace(/\s+/g, " "));
    const problem = tips.includes(tip) ? "duplicate" : tipProblem(tip);
    if (problem) rejected.push({ tip: original, problem });
    else tips.push(tip);
  }
  return { tips: tips.slice(0, MAX_TIPS), rejected };
}

export interface TipsResult {
  /** The tips to store, or null when fewer than MIN_TIPS passed or the output was invalid. */
  tips: string[] | null;
  /** "too_few" is a property of the category and the prompt; "invalid_output" may be transient. */
  outcome: "ok" | "too_few" | "invalid_output";
  rejected: CheckedTips["rejected"];
  usage: LlmUsage;
  model: string;
}

/** One call per category. Temperature 0, so a retry usually gives the same answer. */
export async function generateCategoryTips(
  llm: LlmProvider,
  input: TipsInput,
): Promise<TipsResult> {
  const category = input.category.trim();
  const parent = input.parent_category?.trim();
  const res = await llm.generateStructured({
    system: TIPS_SYSTEM,
    user: JSON.stringify(parent ? { category, parent_category: parent } : { category }),
    schema: tipsSchema,
    maxTokens: 1200,
    temperature: 0,
  });
  const base = { usage: res.usage, model: res.model };
  if (!res.data) return { ...base, tips: null, outcome: "invalid_output", rejected: [] };
  const { tips, rejected } = checkTips(res.data.tips);
  if (tips.length < MIN_TIPS) return { ...base, tips: null, outcome: "too_few", rejected };
  return { ...base, tips, outcome: "ok", rejected };
}
