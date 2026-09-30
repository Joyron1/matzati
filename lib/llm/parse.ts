// Job (a): parse a free-Hebrew query into structured search filters (CLAUDE.md §6.3, contract in
// lib/search/filters.ts). Price chips are rendered by code from the numbers, never by the model.
import { z } from "zod";
import { normalizePhrase, parseSpec } from "@/lib/ranking/match";
import { SYNONYM_GROUPS } from "@/lib/ranking/synonyms";
import type { ParsedQuery, Preference, Requirement } from "@/lib/search/filters";
import type { LlmProvider, LlmUsage } from "./provider";
import { fixSpelling } from "./text-checks";

// Part of the parse cache key (lib/search/cache-key.ts). Bump it on any change to PARSE_SYSTEM,
// parsedQuerySchema, normalizeParsed or the parse model, so cached parses from the old version are
// never served. 6: the code guards of docs/search-quality-plan.md A8 (normalizeParsed). 7: a
// named character, franchise, team or brand is a requirement ("בלונים ליום הולדת של סוניק" found
// Pokémon balloons, 2026-09-30: "sonic" was only a keyword).
export const PARSE_VERSION = 7;

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
  - A character, franchise, team or brand the user named is always a requirement, in the product's own Latin spelling: סוניק -> "sonic", ספיידרמן -> "spiderman" (alt "spider-man"), פרוזן -> "frozen", מכבי -> "maccabi". Otherwise items of another character pass.
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

// Hebrew abbreviations take ״ and ׳; the model sometimes types ASCII quotes (ס"מ, אינץ'). Known
// misspellings, the model's or the shopper's ("עמידות למיים"), are fixed before any chip or
// explanation shows them (fixSpelling).
function hebrew(text: string): string {
  return fixSpelling(
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

/** What normalizeParsed changed in the model's answer beyond spelling and spacing (for evals). */
export type ParseFix =
  | {
      kind: "alt_dropped";
      requirement: string;
      alt: string;
      /** other_meaning: "fast charging" for wireless charging; broader: "sensor" for motion sensor. */
      reason: "other_meaning" | "broader" | "description";
    }
  | { kind: "requirement_rephrased"; from: string; to: string }
  | { kind: "requirement_dropped"; requirement: string; he: string }
  | { kind: "term_added"; term: string; from: string }
  | { kind: "gift_term"; from: string; to: string | null }
  | { kind: "gift_keyword"; from: string; to: string };

// Features that sellers name, beyond the matching synonyms of lib/ranking/synonyms.ts. Only used
// to spot an alt that means something else than its requirement ("heated" slippers are electric,
// "warm" ones are not); the matcher never reads them.
const OTHER_FEATURES: readonly (readonly string[])[] = [
  ["warm", "thermal"],
  ["heated", "heating", "self heating", "electric heating"],
  ["wireless", "cordless", "bluetooth"],
  ["sweatproof", "sweat proof", "sweat resistant"],
  ["light sensor", "dusk to dawn", "photocell"],
];
const FEATURE_GROUPS = [...SYNONYM_GROUPS, ...OTHER_FEATURES];
const featureGroup = new Map(
  FEATURE_GROUPS.flatMap((group, i) => group.map((m) => [normalizePhrase(m), i] as const)),
);
const groupOf = (phrase: string) => featureGroup.get(normalizePhrase(phrase));

// A requirement is a short seller phrase ("wireless charging", "65w"). These make it a description
// no title contains (eval round 3: "supports laptop charging", "multi-device", "for long flights"),
// which rejects nearly every product while its chip looks reasonable.
const DESCRIPTION =
  /\b(?:supports?|supported|compatible|compatibility|multi-?device|universal|and|or)\b|^for\b|&/;
/** Words that do not count toward a phrase's length ("lamp with clamp" is two words). */
const LINK_WORDS = new Set(["with", "for", "of", "the", "a", "an", "to", "in", "on"]);

function isDescription(phrase: string): boolean {
  if (parseSpec(phrase)) return false;
  if (DESCRIPTION.test(phrase)) return true;
  return phrase.split(" ").filter((w) => !LINK_WORDS.has(w)).length > 2;
}

/** The longest known feature phrase inside a description: "heart rate monitor" → "heart rate". */
function featureIn(description: string): string | null {
  const words = ` ${phraseKey(description)} `;
  let best: string | null = null;
  for (const member of FEATURE_GROUPS.flat()) {
    if (words.includes(` ${phraseKey(member)} `) && member.length > (best?.length ?? 0)) {
      best = member;
    }
  }
  return best;
}

/**
 * The phrases of one requirement that a title can state, en first. A description gives way to a
 * known feature inside it or to the first alt that is a seller phrase ("iphone 15 compatible" →
 * "iphone 15"); with neither, the requirement is gone (an empty list). An alt is dropped when it
 * means something else (another feature group: "fast charging" for wireless charging, eval round
 * 3) or is one word of a longer en ("sensor" for motion sensor): either lets through products that
 * lack the requirement, which the explanation then describes as having it.
 */
function sellerPhrases(phrases: string[], fixes: ParseFix[]): string[] {
  const [first, ...rest] = phrases;
  const inside = isDescription(first) ? featureIn(first) : first;
  if (inside && inside !== first) {
    fixes.push({ kind: "requirement_rephrased", from: first, to: inside });
  }
  for (const alt of rest.filter(isDescription)) {
    fixes.push({ kind: "alt_dropped", requirement: first, alt, reason: "description" });
  }
  const candidates = uniquePhrases([
    ...(inside ? [inside] : []),
    ...rest.filter((p) => !isDescription(p)),
  ]);
  if (!candidates.length) return [];
  const [en, ...alts] = candidates;
  if (!inside) fixes.push({ kind: "requirement_rephrased", from: first, to: en });
  const group = groupOf(en);
  const enWords = en.split(" ");
  return [
    en,
    ...alts.filter((alt) => {
      const other = groupOf(alt);
      const reason =
        group !== undefined && other !== undefined && other !== group
          ? "other_meaning"
          : enWords.length > 1 && enWords.includes(alt)
            ? "broader"
            : null;
      if (reason) fixes.push({ kind: "alt_dropped", requirement: en, alt, reason });
      return !reason;
    }),
  ];
}

/** Words of a description that say nothing a title could state ("multi-device", "and"). */
const DESCRIPTION_WORDS = new Set(
  "supports support supported compatible compatibility multi device devices universal and or all any".split(
    " ",
  ),
);

/**
 * The words a dropped description may still show in a title: its phrases' words without
 * description and link words, and without words every product term already says. "multi-device",
 * "laptop and phone", "universal" → ["laptop", "phone"].
 */
function preferenceWords(phrases: string[], productTerms: string[]): string[] {
  const said = new Set(productTerms.flatMap((t) => phraseKey(t).split(" ")));
  const words = phrases
    .flatMap((p) => phraseKey(p).split(" "))
    .filter((w) => /^[a-z]{3,}$/.test(w) && !DESCRIPTION_WORDS.has(w) && !LINK_WORDS.has(w));
  return [...new Set(words)].filter((w) => !said.has(w));
}

function normalizeRequirements(
  raw: ParsedQueryRaw["requirements"],
  productTerms: string[],
  fixes: ParseFix[],
  preferences: Preference[],
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
    const kept = sellerPhrases(phrases, fixes);
    const he = hebrew(r.he);
    if (!kept.length) {
      // Its chip goes too: a chip must name a filter that runs. What the shopper asked for stays
      // as a preference (plan item 8): its words raise relevance, and the page says it was not
      // checked (never silently dropped).
      fixes.push({ kind: "requirement_dropped", requirement: phrases[0], he });
      const words = preferenceWords(phrases, productTerms);
      if (he && preferences.length < MAX_REQUIREMENTS) preferences.push({ words, he });
      continue;
    }
    const [en, ...alt] = kept;
    // One requirement per en across spellings, so chips and chip ids stay unique.
    if (seen.has(squash(en))) continue;
    seen.add(squash(en));
    out.push({ en, alt: alt.slice(0, MAX_ALT), he: he || en });
  }
  return out.slice(0, MAX_REQUIREMENTS);
}

// Who a product is for, and gift words: never part of the product's name (PARSE_SYSTEM says so;
// the model still wrote "kids water bottle" and "cooking gift" in eval round 3).
const AUDIENCE_WORDS = new Set(
  (
    "kids kid children childrens children's child baby babies toddler toddlers men mens men's " +
    "women womens women's boys boy girls girl adult adults dad mom father mother grandma grandpa " +
    "grandmother grandfather him her husband wife boyfriend girlfriend teacher teens"
  ).split(" "),
);
const GIFT_WORDS = new Set(["gift", "gifts", "present", "presents"]);
const OCCASION_WORDS = new Set(
  "birthday christmas xmas anniversary valentine valentines wedding holiday party souvenir".split(
    " ",
  ),
);
const SET_WORDS = new Set(["set", "sets", "kit", "kits"]);
/** "gift box", "gift bag", "gift wrap": gift packaging is a product of its own. */
const PACKAGING_WORDS = new Set(
  "box boxes bag bags wrap wrapping paper card cards basket ribbon tag tags".split(" "),
);

/**
 * A gift is not a product type (eval round 3: "cooking gift" rejected 79 of 94 titles). A request
 * that names no product becomes a set of the named interest: "cooking gift" → "cooking set",
 * "chef gift set" → "chef set"; "gift for dad" names nothing and goes (null). Undefined: the term
 * has no gift word or names gift packaging ("gift box"), and stays.
 */
function giftTerm(term: string): string | null | undefined {
  const words = term.split(" ");
  if (!words.some((w) => GIFT_WORDS.has(w))) return undefined;
  const rest = words.filter(
    (w) =>
      !GIFT_WORDS.has(w) && !OCCASION_WORDS.has(w) && !AUDIENCE_WORDS.has(w) && !LINK_WORDS.has(w),
  );
  if (!rest.length) return null;
  if (rest.every((w) => PACKAGING_WORDS.has(w))) return undefined;
  if (rest.every((w) => SET_WORDS.has(w))) return null;
  return SET_WORDS.has(rest.at(-1)!) ? rest.join(" ") : `${rest.join(" ")} set`;
}

/** The terms with gift terms replaced (giftTerm); the model's own when nothing would be left. */
function withoutGiftTerms(terms: string[], fixes: ParseFix[]): string[] {
  const found: ParseFix[] = [];
  const out = terms.flatMap((from) => {
    const to = giftTerm(from);
    if (to === undefined) return [from];
    found.push({ kind: "gift_term", from, to });
    return to === null ? [] : [to];
  });
  if (!out.length) return terms;
  fixes.push(...found);
  return uniquePhrases(out);
}

/** Keywords of a gift parse: "cooking kitchen gift" → "cooking kitchen set". */
function withoutGiftWords(words: string[], fixes: ParseFix[]): string[] {
  if (!words.some((w) => GIFT_WORDS.has(w))) return words;
  const hasSet = words.some((w) => SET_WORDS.has(w));
  const out = [
    ...new Set(words.flatMap((w) => (!GIFT_WORDS.has(w) ? [w] : hasSet ? [] : ["set"]))),
  ];
  if (!out.some((w) => !SET_WORDS.has(w))) return words;
  fixes.push({ kind: "gift_keyword", from: words.join(" "), to: out.join(" ") });
  return out;
}

/**
 * Nouns that name one kind of product whatever words come before them, so the plain noun is a
 * safe product term: "running earbuds" is still earbuds, and the shopper's use ("לריצה") is left to
 * the requirements and the ranking. Not "mouse" (a mouse pad) or "pillow" (a car headrest).
 */
const PLAIN_PRODUCTS = new Set(
  "earbuds earphones headphones headset smartwatch slippers backpack soundbar".split(" "),
);

/**
 * The product terms, plus the plain product each one names, so the plain product always passes
 * the type gate (docs/search-quality-plan.md A8; on the snapshots pair-a passes 7 of 50 instead of
 * 5 of 98, with the same labels on top): the term without its audience words when two words still
 * name the product ("kids water bottle" → "water bottle"; one word is not enough, "baby monitor"
 * is not any monitor), or its last word when that is a PLAIN_PRODUCTS noun and the term names no
 * audience ("running earbuds" → "earbuds", but "kids headphones" stays as it is). Measured on the
 * snapshots (2026-09-28): without the plain noun, 33 exact and 10 reasonable products of the
 * running-earbuds searches stop passing, and no weak or wrong one.
 */
function withBaseTerms(terms: string[], fixes: ParseFix[]): string[] {
  const out = [...terms];
  const add = (plain: string, from: string) => {
    if (uniquePhrases([...out, plain]).length === out.length) return;
    out.push(plain);
    fixes.push({ kind: "term_added", term: plain, from });
  };
  for (const term of terms) {
    const words = term.split(" ");
    const base = words.filter((w) => !AUDIENCE_WORDS.has(w));
    if (base.length >= 2 && base.length < words.length) add(base.join(" "), term);
    const last = words.at(-1)!;
    // Not for an audience ("kids headphones"): a plain noun there would let every adult product
    // through, and the audience rule above already refuses a one-word product for the same reason.
    const forAudience = words.some((w) => AUDIENCE_WORDS.has(w));
    if (words.length > 1 && !forAudience && PLAIN_PRODUCTS.has(last)) add(last, term);
  }
  return out;
}

const budget = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? n : undefined);

/**
 * Cleans the model output into the shared contract, or null when it cannot drive a search.
 * `query` is the shopper's request; when it says "לגן" about kids (a kindergarten), garden words
 * the model added are removed, as long as a product term and a keyword remain.
 */
export function normalizeParsed(raw: ParsedQueryRaw, query = ""): ParsedQuery | null {
  return normalizeParsedWithFixes(raw, query).parsed;
}

/** normalizeParsed, plus what it changed in the model's answer (docs/search-quality-plan.md A8). */
export function normalizeParsedWithFixes(
  raw: ParsedQueryRaw,
  query = "",
): { parsed: ParsedQuery | null; fixes: ParseFix[] } {
  const fixes: ParseFix[] = [];
  const noGarden = saysKindergarten(query, raw);
  let words = [...new Set(english(raw.keywords_en).split(" ").filter(Boolean))];
  if (noGarden && words.some((w) => !GARDEN_WORD.test(w))) {
    words = words.filter((w) => !GARDEN_WORD.test(w));
  }
  if (words.length === 0 || words.length > MAX_KEYWORD_WORDS) return { parsed: null, fixes };
  let modelTerms = uniquePhrases(raw.product_terms.map(english)).slice(0, MAX_PRODUCT_TERMS);
  if (noGarden && modelTerms.some((t) => withoutGarden(t) === t)) {
    modelTerms = modelTerms.filter((t) => withoutGarden(t) === t);
  }
  if (modelTerms.length === 0) return { parsed: null, fixes };
  const giftFixes = fixes.length;
  modelTerms = withoutGiftTerms(modelTerms, fixes);
  // Only a gift parse (a gift term was replaced) loses "gift" from its keywords: "gift box" stays.
  if (fixes.length > giftFixes) words = withoutGiftWords(words, fixes);
  const productTerms = withBaseTerms(modelTerms, fixes);

  let min = budget(raw.min_price_ils);
  let max = budget(raw.max_price_ils);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const hint = raw.category_hint === null ? "" : english(raw.category_hint);
  const category = noGarden ? withoutGarden(hint) : hint;

  const preferences: Preference[] = [];
  const parsed: ParsedQuery = {
    keywords_en: words.join(" "),
    product_terms: productTerms,
    // Against the model's own terms: an added plain term must not turn a phrase every term says
    // ("wireless" for ["wireless earbuds"]) into a requirement.
    requirements: normalizeRequirements(raw.requirements, modelTerms, fixes, preferences),
    ...(preferences.length ? { preferences } : {}),
    ...(min !== undefined ? { min_price_ils: min } : {}),
    ...(max !== undefined ? { max_price_ils: max } : {}),
    sort_preference: raw.sort_preference,
    product_he: hebrew(raw.product_he) || productTerms[0],
    ...(category ? { category_hint: category } : {}),
  };
  return { parsed, fixes };
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
