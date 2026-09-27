// Job (a): parse a free-Hebrew query into structured search filters (CLAUDE.md §6.3, contract in
// lib/search/filters.ts). Price chips are rendered by code from the numbers, never by the model.
import { z } from "zod";
import type { ParsedQuery, Requirement } from "@/lib/search/filters";
import type { LlmProvider, LlmUsage } from "./provider";

// Part of the parse cache key (lib/search/cache-key.ts). Bump it on any change to PARSE_SYSTEM,
// parsedQuerySchema, normalizeParsed or the parse model, so cached parses from the old version are
// never served.
export const PARSE_VERSION = 2;

const MAX_KEYWORD_WORDS = 6;
const MAX_PRODUCT_TERMS = 4;
const MAX_REQUIREMENTS = 3;
const MAX_ALT = 3;

// What the model must return. Nullable instead of optional keeps the structured-output schema
// simple. Counts are not enforced here: the SDK would validate them client-side and throw, so
// normalizeParsed() caps them instead. Property order is generation order: the model names the
// product before it writes the search words.
export const parsedQuerySchema = z.object({
  product_he: z.string().describe("Short Hebrew product label, spelled correctly"),
  product_terms: z
    .array(z.string())
    .describe("1-4 lowercase English phrases sellers use for the product itself"),
  requirements: z
    .array(
      z.object({
        en: z.string().describe("One lowercase English seller phrase for the whole requirement"),
        alt: z.array(z.string()).describe("0-3 other seller phrasings of the same requirement"),
        he: z.string().describe("Short Hebrew chip label"),
      }),
    )
    .describe("0-3 hard requirements the user stated; a product must meet every one"),
  keywords_en: z
    .string()
    .describe("2-4 English words naming the product the way AliExpress sellers title it"),
  min_price_ils: z.number().nullable().describe("Lower budget bound in shekels, or null"),
  max_price_ils: z.number().nullable().describe("Upper budget bound in shekels, or null"),
  sort_preference: z.enum(["best_value", "cheapest", "most_popular"]),
  category_hint: z.string().nullable().describe("Broader 2-3 word English search phrase, or null"),
});

export type ParsedQueryRaw = z.infer<typeof parsedQuerySchema>;

// Examples are deliberately different from the eval queries (fixtures/llm/), so the eval keeps
// measuring generalization.
export const PARSE_SYSTEM = `You turn an Israeli shopper's free-Hebrew request into search filters for the AliExpress product search API. You do not search or recommend products.

How the code uses your output: keywords_en is sent as is to the AliExpress keyword search. A product is kept only when its English title contains one product_terms phrase AND, for every requirement, its en phrase or one of its alt phrases. Case and hyphens do not matter, so "non slip" also matches "Non-Slip". A spelling written as one word ("nonslip", "powerbank") is a different word, so add it as another phrase when sellers use it.

Read the request as a native speaker first: fix typos and expand slang (טאבלאט = טאבלט, רמקל = רמקול, מיקרופן = מיקרופון, פאוור בנק = סוללה ניידת). Praise such as "אחלה", "מגניב", "טוב" or "איכותי" adds no filter.

Fill the schema:
- product_he: the product in short, correctly spelled Hebrew (up to 20 characters), with the use the user named ("מנורת שולחן", "פנס לקמפינג"). No price and no requirements in it; those get their own labels.
- product_terms: 1-4 lowercase English phrases sellers use in titles for the product itself (not its features), including common seller synonyms. Use one noun when it only names this product (["lantern"]), and two words when the noun alone also names other things (["yoga mat", "exercise mat"], since "mat" alone matches car mats and mouse pads).
- requirements: 0-3 hard requirements the user stated beyond the product itself. A product must meet every one, so add only what the user asked for, never your own ideas.
  - en: ONE lowercase phrase for the whole requirement, the way sellers write it in titles ("foldable", "noise cancelling", "non slip"). Never split a phrase into words: ["noise", "cancelling"] or ["non", "slip"] would match almost any title.
  - alt: 0-3 other seller phrasings of the same requirement, each carrying it whole on its own (["folding", "collapsible"], ["anc", "noise reduction"], ["anti slip"]).
  - he: a short Hebrew chip label ("מתקפל", "סינון רעשים", "נגד החלקה").
  - A numeric spec is one requirement written as number and unit with no space ("20000mah", "144hz", "1tb"), with alt empty.
  - Never use the product itself, or something almost every product of this type has ("bluetooth" for a bluetooth speaker, "portable" for a power bank).
  - A device the product must fit or work with is a requirement only when many products of this type would not ("s24" for a case for גלקסי S24). Leave it out when almost any product of this type works with it.
  - Who it is for, the occasion, a general use ("למשרד", "לקמפינג") and praise are not requirements.
- keywords_en: 2-4 English words naming the product the way AliExpress sellers title it, usually a product_terms phrase, plus the main requirement's phrase or a use word sellers put in titles ("camping", "office") when it fits in 4 words.
  Leave out who it is for or the occasion (gift, mom, boyfriend, men, women, birthday), praise (good, quality, best, durable, premium), a second word with the same meaning ("foldable folding"), and the user's own paraphrase when sellers use a set phrase ("non slip", not "no slipping"). Keep an age or audience word only when sellers make it part of the product name ("baby carrier", "kids scooter").
  When the user names no product ("מתנה למישהי שאוהבת לצייר"), choose the most common product type that fits ("drawing set"), never a brand or one specific model.
- min_price_ils / max_price_ils: only for a budget in shekels (ש״ח, שקל, שקלים, ₪, or a bare number after עד, בפחות מ, מתחת ל, בין or מ). "עד 60", "בפחות מ־300", "מתחת ל־300" -> max. "מ־250", "לפחות 250", "מעל 250" -> min. "בין 40 ל־90" -> min 40 and max 90. Numbers that are specs, sizes, ages or models (20000mAh, 144Hz, 2 מטר, בת 5, גלקסי S24) are never prices. A budget in another currency, or no budget -> both null.
- sort_preference: "cheapest" when the user asks for the cheapest option ("הכי זול", "הזול ביותר"), "most_popular" when they ask for popular or best-selling products ("הכי נמכר", "רב מכר", "פופולרי"), and "best_value" otherwise, including praise ("אחלה", "משתלם").
- category_hint: a broader 2-3 word English search phrase for the same need ("camping lights", "home fitness"), used when the main keywords find too little; or null.

Hebrew labels (product_he and each requirement's he): spell them correctly even when the user wrote a typo or slang, keep the user's meaning exactly, and write abbreviations with ״ and ׳, never ASCII quotes (ס״מ, אינץ׳). Never mention a price; the code shows the budget.

Example. Request: "מנורת שולחן מתקפלת נטענת למשרד עד 120 ש״ח"
{"product_he":"מנורת שולחן למשרד","product_terms":["desk lamp","table lamp"],"requirements":[{"en":"foldable","alt":["folding"],"he":"מתקפלת"},{"en":"rechargeable","alt":["usb charging","built-in battery"],"he":"נטענת"}],"keywords_en":"foldable desk lamp","min_price_ils":null,"max_price_ils":120,"sort_preference":"best_value","category_hint":"office lighting"}`;

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

// Hebrew abbreviations take ״ and ׳; the model sometimes types ASCII quotes (ס"מ, אינץ').
function hebrew(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([א-ת])"(?=[א-ת])/g, "$1״")
    .replace(/([א-ת])'/g, "$1׳");
}

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

/** Cleans the model output into the shared contract, or null when it cannot drive a search. */
export function normalizeParsed(raw: ParsedQueryRaw): ParsedQuery | null {
  const words = [...new Set(english(raw.keywords_en).split(" ").filter(Boolean))];
  if (words.length === 0 || words.length > MAX_KEYWORD_WORDS) return null;
  const productTerms = uniquePhrases(raw.product_terms.map(english)).slice(0, MAX_PRODUCT_TERMS);
  if (productTerms.length === 0) return null;

  let min = budget(raw.min_price_ils);
  let max = budget(raw.max_price_ils);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const category = raw.category_hint === null ? "" : english(raw.category_hint);

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
    const parsed = res.data ? normalizeParsed(res.data) : null;
    if (parsed) return { parsed, usage, model };
  }
  return { parsed: null, usage, model };
}
