// Product-type check (CLAUDE.md §6.5, docs/search-quality-plan.md item 3): does a title name the
// requested product itself, and where. Pure: no I/O, no LLM.
import type { ParsedQuery, SearchFilters } from "@/lib/search/filters";
import { CATEGORY_LABELS, TYPE_GATE } from "./config";
import { connectorFit } from "./connectors";
import { phraseSpans, requirementPhrases, stem, tokenize, type Span } from "./match";
import { CLOSE_PRODUCT_KINDS, PRODUCT_KINDS, PRODUCT_SYNONYM_GROUPS } from "./synonyms";

/**
 * Nouns that make a listing an accessory for the product rather than the product itself, before
 * or right after the product term: "Cable Organizer", "Wireless Charging Ring", "Bike Water Bottle
 * Holder", "Garden Tool Sharpener", "Faucet Splitter Garden ... Tool". Singular, unstemmed.
 */
const ACCESSORY_NOUNS = new Set([
  "organizer",
  "organiser",
  "winder",
  "clip",
  "sticker",
  "ring",
  "protector",
  "bag",
  "strap",
  "case",
  "cover",
  "tie",
  "keeper",
  "management",
  "bank",
  "adapter",
  "adaptor",
  "enclosure",
  "socket",
  "plate",
  "sheet",
  "replacement",
  "film",
  "holder",
  "sharpener",
  "connector",
  "fitting",
  "splitter",
  "accessory",
  "hook",
  "pouch",
  "shield",
  "lid",
]);

/**
 * Nouns that hold or carry a device. Right after the product term they name a holder for it
 * ("Soundbar Stand", "Bluetooth Speaker Mount"); before it they usually describe the listing
 * itself ("Wireless Charger Stand ... Car Mount Phone Holder"), so they count after it only.
 * They name one kind of product: a search for any of them allows all of them.
 */
const HOLDER_NOUNS = new Set(["holder", "stand", "mount", "bracket", "cradle"]);

/**
 * Cables right after a charger's name: "Fast Charger Cable" and "Phone Charger Data Cord" are
 * cables. Only after a charger (CHARGER_NOUNS): a "Power Bank Retractable Cables" is a power bank.
 * A search for a cable or a cord allows both.
 */
const CABLE_NOUNS = new Set(["cable", "cord"]);
const CHARGER_NOUNS = new Set(["charger", "adapter"]);

/**
 * Things a listing is made for. One of them opening the title or right before the product term,
 * when the search did not name it, makes the listing another product: "Car Seat Headrest Neck
 * Pillow" and "Memory Foam Car Neck Pillow" for a travel neck pillow, "Car Under Seat Storage Box
 * ... Drawer Organizer" for a drawer organizer. Anywhere else before the product term it only
 * lowers relevance (lib/ranking/relevance.ts). Not for toy searches (TOY_WORDS), where "Car" and
 * "Truck" name the toy.
 */
const OBJECT_NOUNS = new Set([
  "car",
  "vehicle",
  "truck",
  "bike",
  "bicycle",
  "motorcycle",
  "motorbike",
  "scooter",
  "stroller",
  "tesla",
  "headrest",
]);

/** Words skipped when reading how a title opens: "Universal Car Seat ..." opens with "Car". */
const OPENING_FILLER = new Set(["new", "hot", "universal", "upgraded", "original"]);

/** How many opening words the object rule reads. */
const OPENING_WORDS = 2;

/** Words that already name a light, so a flashlight after them is the same kind of product. */
const LIGHT_WORDS = new Set([
  "light",
  "lamp",
  "headlamp",
  "headlight",
  "lantern",
  "flashlight",
  "torch",
]);

/**
 * Devices that take another product as a feature, named last because the last noun of a
 * compound is what the listing is: "Bike Light Power Bank Flashlight" is a flashlight. Only
 * after the product term: "Flashlight" first is a feature list, not a compound. Each device maps
 * to the words that already name its kind: "Headlamp Flashlight" and "Bike Light Torch" stay
 * lights.
 */
const DEVICE_HEADS = new Map<string, ReadonlySet<string>>([
  ["flashlight", LIGHT_WORDS],
  ["torch", LIGHT_WORDS],
]);

/**
 * Search words that ask for children's products or toys. Without one of them, a toy replica of the
 * product ("Kids Kitchen Toys Pretend Play Cooking Utensils" for cooking utensils) is not it.
 */
const KIDS_OR_TOY_WORDS = new Set([
  "toy",
  "kid",
  "child",
  "children",
  "baby",
  "toddler",
  "boy",
  "girl",
  "montessori",
]);

/** Search words that ask for a toy: then "Car", "Truck" or "Bike" in a title name the toy. */
const TOY_WORDS = new Set(["toy", "plush", "doll", "montessori"]);

/** True when the title sells a pretend-play replica: "Pretend Play", "Role Play", "Play House". */
function isToyReplica(words: string[]): boolean {
  return words.some(
    (w, i) =>
      w === "pretend" ||
      w === "playhouse" ||
      (w === "play" && (words[i - 1] === "role" || words[i + 1] === "house")),
  );
}

/** Words that end a compound: in "Earbuds With Charging Case" the case is not the head noun. */
const LINK_WORDS = new Set(["with", "for", "and", "plus", "include", "included", "including"]);

/** Words that open a part naming what comes with the listing: "... with Bluetooth Speaker". */
export const BUNDLE_WORDS: ReadonlySet<string> = new Set(["with", "include", "including"]);

const hasLetter = (w: string) => /[a-z]/.test(w);

/** True when a head noun follows the span within the compound: the term is only a modifier. */
function hasHeadAfter(words: string[], span: Span, isHead: (i: number) => boolean): boolean {
  const last = Math.min(words.length - 1, span.end + TYPE_GATE.headGap);
  for (let i = span.end + 1; i <= last; i++) {
    if (LINK_WORDS.has(words[i])) return false;
    if (isHead(i)) return true;
  }
  return false;
}

/**
 * True when the span only says what the listing fits or comes with, after the title named
 * something else: "Stand for Bluetooth Speaker" ("for" right before the term) or "Phone Holder
 * with Bluetooth Speaker" ("with" up to TYPE_GATE.bundleGap tokens before it). A title that
 * already said the term's last word restates the product ("Night Light With Motion Sensor
 * Light"), and a title that opens with "for" has named nothing yet. When the noun before "with"
 * is one the shopper searched for (`searchedStems`), the listing is the combination they asked
 * for: "Car Wireless Charger with Phone Holder" for a phone holder with wireless charging.
 */
function namesFitOrPart(words: string[], span: Span, searchedStems: ReadonlySet<string>): boolean {
  const from = Math.max(1, span.start - 1 - TYPE_GATE.bundleGap);
  for (let i = span.start - 1; i >= from; i--) {
    const bundle = BUNDLE_WORDS.has(words[i]);
    if (!bundle && !(words[i] === "for" && i === span.start - 1)) continue;
    if (bundle && searchedStems.has(stem(words[i - 1]))) return false;
    return !words.slice(0, i).includes(words[span.end]);
  }
  return false;
}

let labelTokens: string[][] | undefined;

/**
 * Title positions inside a pasted category label, after its first word ("garden" in "Home
 * Garden"). A label that opens the title names the product ("Home Garden Hose ..."), so only
 * labels after the first word count.
 */
function labelTails(words: string[]): Set<number> {
  labelTokens ??= CATEGORY_LABELS.map((label) => tokenize(label));
  const tails = new Set<number>();
  for (const label of labelTokens) {
    for (let i = 1; i + label.length <= words.length; i++) {
      if (label.every((w, k) => words[i + k] === w)) {
        for (let k = 1; k < label.length; k++) tails.add(i + k);
      }
    }
  }
  return tails;
}

/**
 * One way a product term is matched: `core` in order within the opening, `loose` within the
 * opening in any place, and `forWords` (when set) right after a "for" that follows the core.
 */
export interface TermPhrasing {
  core: string[];
  loose: string[];
  forWords?: string[];
  /** From a CLOSE_PRODUCT_KINDS substitution: near the product, not the product itself. */
  close?: true;
}

let synonymTokens: string[][][] | undefined;

const sameWords = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((w, i) => w === b[i]);

function indexOfWords(words: readonly string[], part: readonly string[]): number {
  for (let i = 0; i + part.length <= words.length; i++) {
    if (part.every((w, k) => words[i + k] === w)) return i;
  }
  return -1;
}

let kindTokens: (readonly [string[], string[]])[] | undefined;
let closeKindTokens: (readonly [string[], string[]])[] | undefined;

/** A phrasing of a term and whether it came from a close kind (CLOSE_PRODUCT_KINDS). */
interface Variant {
  words: string[];
  close: boolean;
}

/**
 * The phrase plus each PRODUCT_SYNONYM_GROUPS substitution ("sports earbud" → "sports earphone")
 * each one-way PRODUCT_KINDS one ("drawer organizer" → "cutlery tray") and each close one
 * (CLOSE_PRODUCT_KINDS, marked close: "pop figure" → "action figure").
 */
function withSynonyms(core: string[]): Variant[] {
  synonymTokens ??= PRODUCT_SYNONYM_GROUPS.map((g) => g.map((m) => tokenize(m)));
  kindTokens ??= PRODUCT_KINDS.map(([from, to]) => [tokenize(from), tokenize(to)] as const);
  closeKindTokens ??= CLOSE_PRODUCT_KINDS.map(
    ([from, to]) => [tokenize(from), tokenize(to)] as const,
  );
  const out: Variant[] = [{ words: core, close: false }];
  const add = (at: number, member: readonly string[], other: readonly string[], close = false) => {
    const next = [...core.slice(0, at), ...other, ...core.slice(at + member.length)];
    // "house slipper" with "house shoe" for "slipper" is "house shoe", not "house house shoe".
    const variant = next.filter((w, i) => w !== next[i - 1]);
    if (!out.some((v) => sameWords(v.words, variant))) out.push({ words: variant, close });
  };
  for (const group of synonymTokens) {
    for (const member of group) {
      const at = indexOfWords(core, member);
      if (at < 0) continue;
      for (const other of group) if (other !== member) add(at, member, other);
    }
  }
  for (const [from, to] of kindTokens) {
    const at = indexOfWords(core, from);
    if (at >= 0) add(at, from, to);
  }
  for (const [from, to] of closeKindTokens) {
    const at = indexOfWords(core, from);
    if (at >= 0) add(at, from, to, true);
  }
  return out;
}

const hasDigit = (w: string) => /\d/.test(w);

/** Tokens after the product words within which a loose word still belongs to them. */
const LOOSE_AFTER = 3;

/**
 * True when every loose word of a phrasing (TermPhrasing.loose) stands in the opening before the
 * product words, between them ("Car Wireless Charger"), or at most LOOSE_AFTER tokens after them
 * ("Water Bottle For Kids"), and on its own: a word far past the product words describes
 * something else ("Garden Tools Set 3pcs Trowel Rake Kitchen Garden" is not a kitchen tool set),
 * and "multi-color" says a product has many colors (juggling sandbags), not that it is a color toy.
 */
function looseWordsNear(opening: readonly string[], loose: readonly string[], span: Span): boolean {
  return loose.every((w) =>
    opening.some((t, i) => t === w && opening[i - 1] !== "multi" && i - span.end <= LOOSE_AFTER),
  );
}

/**
 * How a product term is matched against titles (docs/search-quality-plan.md, item 3; each rule was
 * measured on the snapshots with lib/eval before it was kept):
 * - leading words that restate a requirement are dropped: the requirement already checks them
 *   ("warm slippers" with the requirement "warm" is "slippers"; "leak proof bottle" is "bottle");
 * - in a term of three or more words the last two name the product, and the words before them may
 *   stand anywhere before them in the opening or right after them ("kids water bottle" matches
 *   "Dinosaur Water Bottle For Kids"; looseWordsNear), unless one of the last two is a number
 *   ("iphone 15 cable");
 * - the product words are also tried with their PRODUCT_SYNONYM_GROUPS names;
 * - the last word followed later by "for" and the other words also says it ("running earbuds" in
 *   "Wireless Earbuds ... Waterproof for Running").
 */
export function termPhrasings(
  term: string,
  requirementWords: readonly (readonly string[])[] = [],
): TermPhrasing[] {
  let words = tokenize(term);
  const restated = () =>
    requirementWords.find(
      (phrase) => phrase.length < words.length && sameWords(words.slice(0, phrase.length), phrase),
    );
  for (let phrase = restated(); phrase; phrase = restated()) words = words.slice(phrase.length);
  const phrasings: TermPhrasing[] = [];
  for (const { words: variant, close } of withSynonyms(words)) {
    const split = variant.length >= 3 && !variant.slice(-2).some(hasDigit) ? variant.length - 2 : 0;
    const loose = variant.slice(0, split);
    const core = variant.slice(split);
    const mark = close ? { close: true as const } : {};
    phrasings.push({ core, loose, ...mark });
    // "Case For iPhone 17 16 15" says "iphone 17 case": a number in the "for" words is a model
    // (live SEO page "כיסוי לאייפון 17", 2026-10-04: 205 cases turned away), never in the noun.
    if (core.length >= 2 && !hasDigit(core[core.length - 1])) {
      phrasings.push({ core: core.slice(-1), loose, forWords: core.slice(0, -1), ...mark });
    }
  }
  return phrasings;
}

type GateFilters = Pick<SearchFilters, "keywords_en" | "product_terms"> &
  Partial<Pick<SearchFilters, "requirements">> &
  Partial<Pick<ParsedQuery, "product_he">>;

/** The shopper's own words; naming one holder noun names them all (HOLDER_NOUNS). */
function searchedWords(f: GateFilters): Set<string> {
  const searched = new Set(tokenize([f.keywords_en, ...f.product_terms].join(" ")));
  if ([...searched].some((w) => HOLDER_NOUNS.has(w))) {
    for (const w of HOLDER_NOUNS) searched.add(w);
  }
  return searched;
}

/** Index after the last token of the opening: the first TYPE_GATE.windowTokens words. */
function openingEnd(words: string[]): number {
  let seen = 0;
  for (let i = 0; i < words.length; i++) {
    if (hasLetter(words[i]) && ++seen > TYPE_GATE.windowTokens) return i;
  }
  return words.length;
}

/** Word position of a token index: how many tokens with a letter come before it. */
const wordIndex = (words: string[], at: number) => words.slice(0, at).filter(hasLetter).length;

/** Where the title names the requested product. */
export interface ProductMatch {
  /** Word index (tokens with a letter) where the earliest product term starts. */
  position: number;
  /**
   * Made for an object the search did not name: one comes before the term ("Travel Car Neck
   * Pillow", "Seat Headrest Travel Rest Neck Pillow") or right after a "for" ("... for Tesla").
   */
  forOtherObject: boolean;
  /**
   * The first product term (the parse's main name for the product) matched word for word, not
   * only through a synonym, a shortened phrasing or a later, broader term ("storage organizer"
   * for "drawer organizer").
   */
  primary: boolean;
  /**
   * Named only through a close kind (CLOSE_PRODUCT_KINDS: an anime figure for a pop figure): near
   * the product, not the product itself. The search ranking shows it after every exact match.
   */
  close: boolean;
}

const splitWords = (phrase: string) => phrase.split(" ");

/** "for" somewhere after token `end`, followed by `forWords` in order ("for Running Sports"). */
function saysForAfter(words: string[], end: number, forWords: string[]): boolean {
  for (let j = end + 1; j < words.length - 1; j++) {
    if (words[j] !== "for") continue;
    const after = phraseSpans(words.slice(j + 1), forWords.join(" "), splitWords, 1);
    if (after.some((s) => s.start === 0)) return true;
  }
  return false;
}

/**
 * Where the title names the requested product itself, or null when it does not: a product term
 * (see termPhrasings) within the first TYPE_GATE.windowTokens words that is not only what the
 * listing fits or comes with (namesFitOrPart), does not borrow a word from a category label
 * (CATEGORY_LABELS), does not reach across a noun of another thing ("Neck Headrest Pillow") and
 * does not follow an object ("Car Neck Pillow"); no accessory noun before it, no accessory or
 * holder noun right after it, and no unsearched object ("Car ...") opening the title. An
 * accessory or object noun the shopper searched for ("phone case", "car phone holder") is
 * allowed. A pretend-play toy is kept only when the search is for kids or toys, and a cable whose
 * only plug is another connector than the searched device's port is not the product ("USB C To
 * Lightning Cable For iPhone 15 14 13" for an iPhone 15; connectorFit in ./connectors). No product
 * terms: no check.
 * Product terms match whole singular words, not stems: a stem would let "charger" match
 * "Charging Cable", "light" match "Lighter" and "mount" match "Mounting Tape".
 */
export function productMatch(title: string, f: GateFilters): ProductMatch | null {
  if (!f.product_terms.length) {
    return { position: 0, forOtherObject: false, primary: true, close: false };
  }
  if (connectorFit(title, f) === "wrong") return null;
  const words = tokenize(title);
  const searched = searchedWords(f);
  const searchedStems = new Set([...searched].map(stem));
  const forKids = [...searched].some((w) => KIDS_OR_TOY_WORDS.has(w));
  if (isToyReplica(words) && !forKids) return null;

  const forToys = [...searched].some((w) => TOY_WORDS.has(w));
  const isObject = (w: string) => !forToys && OBJECT_NOUNS.has(w) && !searched.has(w);
  const isAccessory = (w: string) => ACCESSORY_NOUNS.has(w) && !searched.has(w);
  const isHolder = (w: string) => HOLDER_NOUNS.has(w) && !searched.has(w);
  const opening = words.slice(0, openingEnd(words));
  const tails = labelTails(words);
  const requirementWords = (f.requirements ?? []).flatMap((r) =>
    requirementPhrases(r).map((p) => tokenize(p)),
  );
  // A span is the product unless it reaches across a noun of another thing ("Neck Headrest
  // Pillow"), follows an object right before it ("Car Neck Pillow"), lacks its "for" words, sits
  // in a pasted category label or only says what the listing fits or comes with.
  const isProductSpan = (s: Span, ph: TermPhrasing) =>
    !words
      .slice(s.start + 1, s.end)
      .some((w) => !ph.core.includes(w) && (isAccessory(w) || isHolder(w) || isObject(w))) &&
    !(s.start > 0 && isObject(words[s.start - 1])) &&
    (!ph.forWords || saysForAfter(words, s.end, ph.forWords)) &&
    !tails.has(s.start) &&
    !namesFitOrPart(words, s, searchedStems);
  // Every phrasing of every term; `primary` marks the first term, word for word.
  const phrasings = f.product_terms.flatMap((term) =>
    termPhrasings(term, requirementWords).map((ph) => ({ ph, primary: false })),
  );
  phrasings.push({ ph: { core: tokenize(f.product_terms[0]), loose: [] }, primary: true });
  const matched = phrasings.flatMap(({ ph, primary }) =>
    phraseSpans(opening, ph.core.join(" "), splitWords, TYPE_GATE.maxGap)
      .filter((s) => looseWordsNear(opening, ph.loose, s) && isProductSpan(s, ph))
      .map((span) => ({ span, primary, close: ph.close === true })),
  );
  const spans = matched.map((m) => m.span);
  if (!spans.length) return null;

  // A device of another kind: a flashlight after "Power Bank", not after "Bike Light".
  const isDeviceFor = (i: number, s: Span) => {
    const kind = DEVICE_HEADS.get(words[i]);
    return kind !== undefined && !kind.has(words[s.end]) && !searched.has(words[i]);
  };
  const first = Math.min(...spans.map((s) => s.start));
  for (let i = 0; i < first; i++) if (isAccessory(words[i])) return null;
  const cableSearched = [...CABLE_NOUNS].some((w) => searched.has(w));
  const isCableFor = (i: number, s: Span) =>
    !cableSearched && CABLE_NOUNS.has(words[i]) && CHARGER_NOUNS.has(words[s.end]);
  const headAfter = (s: Span) =>
    hasHeadAfter(
      words,
      s,
      (i) => isAccessory(words[i]) || isHolder(words[i]) || isCableFor(i, s) || isDeviceFor(i, s),
    );
  if (spans.some(headAfter)) return null;
  // The product's own noun right after an unsearched object anywhere in the opening: the listing
  // is that object's version of it ("65W Fast Charger Car Charger", "... for Xiaomi Charger" after
  // "Magnetic Car Charger"), whichever span matched.
  const heads = new Set(spans.map((s) => words[s.end]));
  if (opening.some((w, i) => i > 0 && heads.has(w) && isObject(opening[i - 1]))) return null;

  // Quantities ("1PCS", "2025"), "for" ("YZ for Tesla ...") and filler do not name anything.
  const openingWords = words.filter(
    (w) => /^[a-z]+$/.test(w) && w !== "for" && !OPENING_FILLER.has(w),
  );
  if (openingWords.slice(0, OPENING_WORDS).some(isObject)) return null;
  return {
    position: wordIndex(words, first),
    forOtherObject:
      words.slice(0, first).some(isObject) ||
      words.some((w, i) => w === "for" && isObject(words[i + 1] ?? "")),
    primary: matched.some((m) => m.primary),
    close: matched.every((m) => m.close),
  };
}

/** True when the title names the requested product itself (see productMatch). */
export function isRequestedProduct(title: string, f: GateFilters): boolean {
  return productMatch(title, f) !== null;
}
