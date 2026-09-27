// Job (a): parse a free-Hebrew query into structured search filters (CLAUDE.md §6.3, contract in
// lib/search/filters.ts). Price chips are rendered by code from the numbers, never by the model.
import { z } from "zod";
import type { ParsedQuery, Requirement } from "@/lib/search/filters";
import type { LlmProvider, LlmUsage } from "./provider";

// Part of the parse cache key (lib/search/cache-key.ts). Bump it on any change to PARSE_SYSTEM,
// parsedQuerySchema, normalizeParsed or the parse model, so cached parses from the old version are
// never served.
export const PARSE_VERSION = 5;

const MAX_KEYWORD_WORDS = 6;
const MAX_PRODUCT_TERMS = 4;
const MAX_REQUIREMENTS = 3;
const MAX_ALT = 3;

// What the model must return. Nullable instead of optional keeps the structured-output schema
// simple. Counts are not enforced here: the SDK would validate them client-side and throw, so
// normalizeParsed() caps them instead. Property order is generation order: the model names the
// product before it writes the search words.
// No .describe() on purpose: PARSE_SYSTEM explains every field, and a description makes zod emit
// $defs/$ref/anyOf, which cost ~390 input tokens per call (countTokens, 2026-09-27).
export const parsedQuerySchema = z.object({
  product_he: z.string(),
  product_terms: z.array(z.string()),
  requirements: z.array(
    z.object({
      en: z.string(),
      alt: z.array(z.string()),
      he: z.string(),
    }),
  ),
  keywords_en: z.string(),
  min_price_ils: z.number().nullable(),
  max_price_ils: z.number().nullable(),
  sort_preference: z.enum(["best_value", "cheapest", "most_popular"]),
  category_hint: z.string().nullable(),
});

export type ParsedQueryRaw = z.infer<typeof parsedQuerySchema>;

// Examples are deliberately different from the eval queries (fixtures/llm/), so the eval keeps
// measuring generalization.
export const PARSE_SYSTEM = `Turn a Hebrew shopping request into AliExpress search filters. keywords_en is the search query; a product is kept only if its English title has a product_terms phrase and, per requirement, its en or an alt. A one-word spelling ("powerbank") matches only itself; add it if sellers use it.

Fix typos and slang (רמקל=רמקול). "גן ילדים", or "לגן"/"בגן" with something a child takes or wears there (bottle, bag, shoes), is a kindergarten, not a garden ("בקבוק לגן" is a kids water bottle): write "kids" or nothing, never "garden". With plants, lighting, furniture or tools, "לגן" is a garden.

- product_he: the product in short Hebrew (≤20 chars) with its named use ("מנורת שולחן למשרד"), no requirements.
- product_terms: 1-4 seller phrases for the product itself (not features), with synonyms. Two words when the noun alone names other things ("yoga mat", not "mat"). Never gift, occasion or audience words: when no product is named ("מתנה למישהי שאוהבת לצייר"), use the most common fitting product type ("drawing set"), never a brand or model.
- requirements: 0-3 hard requirements the user stated. A product must meet every one, so never add your own.
  - en: ONE short phrase for the whole requirement, the way sellers write it in titles ("foldable", "noise cancelling"). Never split into words, never a description.
  - alt: 0-3 other seller phrasings, each whole ("anc", "noise reduction").
  - Numeric spec: number+unit, no space ("65w"), alt empty.
  - Not requirements: the product itself; what nearly all such products have ("bluetooth" for a speaker); a device it fits or works with, unless many such products would not ("s24" for a phone case); who it is for, the occasion, a general use ("למשרד", "לקמפינג") and praise.
- keywords_en: 2-4 words as sellers title it: a product_terms phrase plus the main requirement or a use word ("camping"). No gift, occasion, audience or praise words (gift, mom, best) unless part of the product name ("kids scooter"); no synonym pairs ("foldable folding").
- min/max_price_ils: a shekel budget only (ש״ח, ₪ or a bare number): עד/בפחות מ/מתחת ל X -> max; מ/מעל/לפחות X -> min; בין X ל־Y -> both. Ages, sizes, specs and models (בת 5, 2 מטר, S24) are not prices. Otherwise null.
- sort_preference: cheapest for הכי זול, most_popular for popular or best-selling, else best_value.
- category_hint: broader 2-3 word English phrase or null.

Hebrew labels (product_he, requirement he): short and spelled right, the usual phrase ("אטום לדליפות"), with ״ ׳ never ASCII quotes (ס״מ). Never a price.

Example: "מנורת שולחן מתקפלת נטענת למשרד עד 120 ש״ח" -> {"product_he":"מנורת שולחן למשרד","product_terms":["desk lamp","table lamp"],"requirements":[{"en":"foldable","alt":["folding"],"he":"מתקפלת"},{"en":"rechargeable","alt":["usb charging","built-in battery"],"he":"נטענת"}],"keywords_en":"foldable desk lamp","min_price_ils":null,"max_price_ils":120,"sort_preference":"best_value","category_hint":"office lighting"}`;

// Sent on a retry. The parse runs at temperature 0, so repeating the same request would mostly
// repeat the same unusable answer.
const RETRY_NOTE = `A previous answer to this request was unusable: keywords_en was empty or longer than ${MAX_KEYWORD_WORDS} words, or product_terms had no phrase. Follow the rules above exactly.`;

// Glue a number to its unit ("65 W" -> "65w"), so one spec always gives one cache key and match.
const UNIT_GAP = /(\d)\s+(w|mah|wh|gb|tb|hz|v|mm|cm|m|inch|ml|l|kg|g)\b/g;

function english(text: string): string {
  return text
    .toLowerCase()
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(UNIT_GAP, "$1$2");
}

/** Misspelled words the model wrote in Hebrew labels, and their spelling ("אטום לדיסות", eval round 2). */
const MISSPELLINGS: [string, string][] = [["דיסות", "דליפות"]];
const misspelled = MISSPELLINGS.map(
  ([wrong, right]) =>
    [new RegExp(`(^|[^א-ת])([ובלהמש]?)${wrong}(?![א-ת])`, "g"), `$1$2${right}`] as const,
);

// Hebrew abbreviations take ״ and ׳; the model sometimes types ASCII quotes (ס"מ, אינץ').
function hebrew(text: string): string {
  return misspelled.reduce(
    (s, [re, fix]) => s.replace(re, fix),
    text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/([א-ת])"(?=[א-ת])/g, "$1״")
      .replace(/([א-ת])'/g, "$1׳"),
  );
}

// "לגן" and "בגן" are a kindergarten when the request is about kids; the model once made "בקבוק
// מים לגן" a "garden bottle" (eval round 2). They are a garden too ("תאורה סולארית לגן"), so the
// guard needs a kids context: a Hebrew kids word in the request, or one in the model's own English
// (that parse's category_hint was "children water bottles"). A garden is also גינה, a gardener
// גנן, and "גן ירק" really is a garden.
const KINDERGARTEN =
  /(^|[^א-ת])(ו?[לב]גן(?![א-ת])(?!\s+(?:ירק|ירקות|בוטני|ורדים)(?![א-ת]))|גן\s+ילדים)/;
const GARDENING = /(^|[^א-ת])[ובלהמש]{0,2}(?:גינה|גינות|גינון|גנן)(?![א-ת])/;
const KIDS_HE =
  /(^|[^א-ת])[ובלהמש]{0,2}(?:ילד|ילדה|ילדים|ילדות|תינוק|תינוקת|תינוקות|פעוט|פעוטה|פעוטות|גננת)(?![א-ת])|(^|[^א-ת])[ולה]?(?:בן|בת)\s+\d/;
const KIDS_EN =
  /\b(?:kids?|child|children|childrens|toddlers?|bab(?:y|ies)|preschool|kindergarten|school|boys?|girls?)\b/;
const GARDEN_WORD = /^garden(?:ing|s)?$/;

function saysKindergarten(query: string, raw: ParsedQueryRaw): boolean {
  if (!KINDERGARTEN.test(query) || GARDENING.test(query)) return false;
  const modelText = [raw.keywords_en, ...raw.product_terms, raw.category_hint ?? ""].join(" ");
  return KIDS_HE.test(query) || KIDS_EN.test(modelText.toLowerCase());
}
const withoutGarden = (phrase: string) =>
  phrase
    .split(" ")
    .filter((w) => !GARDEN_WORD.test(w))
    .join(" ");

// "Non-Slip" and "non slip" are the same words. A one-word spelling ("nonslip") stays a separate
// phrase, because a word-based title match treats it differently.
const phraseKey = (phrase: string) =>
  phrase
    .split(/[\s-]+/)
    .filter(Boolean)
    .join(" ");
const squash = (phrase: string) => phrase.replace(/[\s-]+/g, "");

function uniquePhrases(phrases: string[]): string[] {
  const seen = new Set<string>();
  return phrases.filter((p) => {
    const key = phraseKey(p);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRequirements(
  raw: ParsedQueryRaw["requirements"],
  productTerms: string[],
): Requirement[] {
  // A phrase that every product term already says is met by any matching title, so it would
  // filter nothing while its chip promised something (the eval's must_have ["smart", "watch"]).
  // Every term, because a title needs only one: with ["wireless earbuds", "earbuds"], "wireless"
  // still filters. Whole words, so "usb c" is a real requirement for a "usb cable"; a one-word
  // spelling ("smartwatch") counts as saying its parts only next to a term that says them in
  // words, so "phone" still filters for a lone "microphone".
  const says = (t: string, p: string) =>
    ` ${phraseKey(t)} `.includes(` ${phraseKey(p)} `) || squash(t) === squash(p);
  const saysAsOneWord = (t: string, p: string) => !/[\s-]/.test(t) && t.includes(squash(p));
  const covered = (p: string) =>
    productTerms.some((t) => says(t, p)) &&
    productTerms.every((t) => says(t, p) || saysAsOneWord(t, p));
  const out: Requirement[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    // An empty en is replaced by the first alt, so a stated requirement is not silently lost.
    const phrases = uniquePhrases([r.en, ...r.alt].map(english)).filter((p) => !covered(p));
    if (!phrases.length) continue;
    const [en, ...alt] = phrases;
    // One requirement per en across spellings, so chips and chip ids stay unique.
    if (seen.has(squash(en))) continue;
    seen.add(squash(en));
    out.push({ en, alt: alt.slice(0, MAX_ALT), he: hebrew(r.he) || en });
  }
  return out.slice(0, MAX_REQUIREMENTS);
}

const budget = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? n : undefined);

/**
 * Cleans the model output into the shared contract, or null when it cannot drive a search.
 * `query` is the shopper's request; when it says "לגן" about kids (a kindergarten), garden words
 * the model added are removed, as long as a product term and a keyword remain.
 */
export function normalizeParsed(raw: ParsedQueryRaw, query = ""): ParsedQuery | null {
  const noGarden = saysKindergarten(query, raw);
  let words = [...new Set(english(raw.keywords_en).split(" ").filter(Boolean))];
  if (noGarden && words.some((w) => !GARDEN_WORD.test(w))) {
    words = words.filter((w) => !GARDEN_WORD.test(w));
  }
  if (words.length === 0 || words.length > MAX_KEYWORD_WORDS) return null;
  let productTerms = uniquePhrases(raw.product_terms.map(english)).slice(0, MAX_PRODUCT_TERMS);
  if (noGarden && productTerms.some((t) => withoutGarden(t) === t)) {
    productTerms = productTerms.filter((t) => withoutGarden(t) === t);
  }
  if (productTerms.length === 0) return null;

  let min = budget(raw.min_price_ils);
  let max = budget(raw.max_price_ils);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const hint = raw.category_hint === null ? "" : english(raw.category_hint);
  const category = noGarden ? withoutGarden(hint) : hint;

  return {
    keywords_en: words.join(" "),
    product_terms: productTerms,
    requirements: normalizeRequirements(raw.requirements, productTerms),
    ...(min !== undefined ? { min_price_ils: min } : {}),
    ...(max !== undefined ? { max_price_ils: max } : {}),
    sort_preference: raw.sort_preference,
    product_he: hebrew(raw.product_he) || productTerms[0],
    ...(category ? { category_hint: category } : {}),
  };
}

export interface ParseResult {
  parsed: ParsedQuery | null;
  usage: LlmUsage[];
  model: string;
}

/** One LLM call per attempt; the spec allows one retry on unusable output. */
export async function parseQuery(
  llm: LlmProvider,
  query: string,
  { maxAttempts = 2 }: { maxAttempts?: number } = {},
): Promise<ParseResult> {
  const usage: LlmUsage[] = [];
  let model = llm.model;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await llm.generateStructured({
      system: attempt === 0 ? PARSE_SYSTEM : `${PARSE_SYSTEM}\n\n${RETRY_NOTE}`,
      user: query,
      schema: parsedQuerySchema,
      maxTokens: 1024,
      // The same request should always give the same filters, so paraphrases share the cache.
      temperature: 0,
    });
    usage.push(res.usage);
    model = res.model;
    const parsed = res.data ? normalizeParsed(res.data, query) : null;
    if (parsed) return { parsed, usage, model };
  }
  return { parsed: null, usage, model };
}
