// Deterministic filter and rank (CLAUDE.md §6.5-6). Pure: no I/O, no LLM.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { SearchFilters, SortPreference } from "@/lib/search/filters";
import {
  CATEGORY_LABELS,
  DEDUP,
  FEEDBACK_PRIOR,
  FILL_TIER,
  FILTERS,
  PRICE_FIT,
  TYPE_GATE,
  WEIGHTS,
  type TrustThresholds,
} from "./config";
import { phraseSpans, requirementMatches, stem, tokenize, type Span } from "./match";

export type RejectReason = "feedback" | "volume" | "currency" | "price" | "type" | "requirement";

/**
 * Nouns that make a listing an accessory for the product rather than the product itself, before
 * or right after the product term: "Cable Organizer", "Wireless Charging Ring", "Bike Water Bottle
 * Holder", "Shower Phone Holder with Bluetooth Speaker". Singular, unstemmed.
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
]);

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
const BUNDLE_WORDS = new Set(["with", "include", "including"]);

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
 * True when the title names the requested product itself: a product term within the first
 * TYPE_GATE.windowTokens tokens that is not only what the listing fits or comes with
 * (namesFitOrPart) and does not borrow a word from a category label (CATEGORY_LABELS); no
 * accessory noun before it, and no head noun right after it. An accessory noun the user searched
 * for ("phone case") is allowed. A pretend-play toy is kept only when the search is for kids or
 * toys. No product terms: no check.
 * Product terms match whole singular words, not stems: a stem would let "charger" match
 * "Charging Cable", "light" match "Lighter" and "mount" match "Mounting Tape".
 */
export function isRequestedProduct(
  title: string,
  f: Pick<SearchFilters, "keywords_en" | "product_terms">,
): boolean {
  if (!f.product_terms.length) return true;
  const words = tokenize(title);
  const opening = words.slice(0, TYPE_GATE.windowTokens);
  const searched = new Set(tokenize([f.keywords_en, ...f.product_terms].join(" ")));
  const searchedStems = new Set([...searched].map(stem));
  if (isToyReplica(words) && ![...searched].some((w) => KIDS_OR_TOY_WORDS.has(w))) return false;
  const tails = labelTails(words);
  const spans = f.product_terms
    .flatMap((term) => phraseSpans(opening, term, tokenize))
    .filter((s) => !tails.has(s.start) && !namesFitOrPart(words, s, searchedStems));
  if (!spans.length) return false;

  const isAccessory = (i: number) => ACCESSORY_NOUNS.has(words[i]) && !searched.has(words[i]);
  // A device of another kind: a flashlight after "Power Bank", not after "Bike Light".
  const isDeviceFor = (i: number, s: Span) => {
    const kind = DEVICE_HEADS.get(words[i]);
    return kind !== undefined && !kind.has(words[s.end]) && !searched.has(words[i]);
  };
  const first = Math.min(...spans.map((s) => s.start));
  for (let i = 0; i < first; i++) if (isAccessory(i)) return false;
  return !spans.some((s) => hasHeadAfter(words, s, (i) => isAccessory(i) || isDeviceFor(i, s)));
}

/** Missing trust data fails (never treated as good); prices are never compared across currencies. */
export function passesFilters(
  p: AliProduct,
  f: SearchFilters,
  trust: TrustThresholds = FILTERS,
): boolean {
  return rejectReason(p, f, trust) === null;
}

/** First filter each product fails, or null when it passes. */
export function rejectReason(
  p: AliProduct,
  f: SearchFilters,
  trust: TrustThresholds = FILTERS,
): RejectReason | null {
  if (p.positiveFeedbackPct === null || p.positiveFeedbackPct < trust.minPositiveFeedbackPct) {
    return "feedback";
  }
  if (p.unitsSold === null || p.unitsSold < trust.minUnitsSold) return "volume";
  if (p.currency !== "ILS") return "currency";
  if (f.min_price_ils !== undefined && p.price < f.min_price_ils) return "price";
  if (f.max_price_ils !== undefined && p.price > f.max_price_ils) return "price";
  if (!isRequestedProduct(p.title, f)) return "type";
  if (!f.requirements.every((r) => requirementMatches(p.title, r))) return "requirement";
  return null;
}

/** How many products each filter removed. Drives the "no results" hint in the UI. */
export function rejectionCounts(
  products: AliProduct[],
  f: SearchFilters,
): Record<RejectReason, number> {
  const counts: Record<RejectReason, number> = {
    feedback: 0,
    volume: 0,
    currency: 0,
    price: 0,
    type: 0,
    requirement: 0,
  };
  for (const p of products) {
    const r = rejectReason(p, f);
    if (r) counts[r]++;
  }
  return counts;
}

/** Positive feedback with small-sample ratings above FEEDBACK_PRIOR.pct pulled down toward it. */
export function effectiveFeedbackPct(p: AliProduct): number {
  const pct = p.positiveFeedbackPct ?? 0;
  if (pct <= FEEDBACK_PRIOR.pct) return pct;
  const n = p.unitsSold ?? 0;
  return (pct * n + FEEDBACK_PRIOR.pct * FEEDBACK_PRIOR.sales) / (n + FEEDBACK_PRIOR.sales);
}

/** Linear-interpolated percentile of ascending values. */
function percentile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Price scale for scoring: from the PRICE_FIT.floorPercentile price to the most expensive. */
export function priceRange(prices: number[]): { min: number; max: number } {
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    min: percentile(sorted, PRICE_FIT.floorPercentile),
    max: sorted[sorted.length - 1],
  };
}

interface ScoreContext {
  sort: SortPreference;
  priceRange: { min: number; max: number };
}

export function score(p: AliProduct, ctx: ScoreContext): number {
  // 90% → 0, 100% → 1
  const feedback = Math.max(0, (effectiveFeedbackPct(p) - FILTERS.minPositiveFeedbackPct) / 10);
  // 100 sales → 0.5, 10,000 → 1, capped so huge sellers don't drown everything else
  const volume = Math.min(1.25, Math.log10(Math.max(1, p.unitsSold ?? 0)) / 4);
  const { min, max } = ctx.priceRange;
  // At or below the floor price → 1, most expensive → 0
  const priceFit = max > min ? Math.min(1, Math.max(0, (max - p.price) / (max - min))) : 1;
  const discount = (p.discountPct ?? 0) / 100;

  const w = WEIGHTS;
  return (
    feedback * w.feedback +
    volume * (ctx.sort === "most_popular" ? w.volumeMostPopular : w.volume) +
    priceFit * w.priceFit +
    discount * w.discount
  );
}

interface Listing {
  title: string;
  first: string | undefined;
  model: string | null;
  shop: string | null;
  tokens: Set<string>;
}

/** Leading letters of tokens that look like models but are specs or compatibility: ipx8, usb3, v5. */
const SPEC_PREFIXES = new Set(["ip", "ipx", "usb", "pd", "qc", "v", "bt", "wifi", "hdmi", "gen"]);

/**
 * The listing's own model token near the start ("POLVCDG X9", "Original SP16"). Tokens after
 * "for" name what it fits, not what it is, and so does a model the shopper searched for ("s24"
 * in a search for a Galaxy S24 case, where "Samsung S24 Case ..." titles are all different cases).
 */
function modelToken(tokens: string[], searched: ReadonlySet<string>): string | null {
  for (const t of tokens.slice(0, DEDUP.modelTokenWindow)) {
    if (t === "for") return null;
    const m = /^([a-z]+)\d+[a-z]*$/.exec(t);
    if (m && !SPEC_PREFIXES.has(m[1]) && !searched.has(t)) return t;
  }
  return null;
}

function listing(p: AliProduct, searched: ReadonlySet<string>): Listing {
  const tokens = tokenize(p.title).map(stem);
  return {
    title: tokens.join(" "),
    first: tokens[0],
    model: modelToken(tokens, searched),
    shop: p.shop.id,
    tokens: new Set(tokens),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

function isSameProduct(a: Listing, b: Listing): boolean {
  if (a.title === b.title) return true;
  if (a.model !== null && a.model === b.model && a.first === b.first) return true;
  return (
    a.shop !== null && a.shop === b.shop && jaccard(a.tokens, b.tokens) >= DEDUP.sameShopJaccard
  );
}

/**
 * Drops listings of a product already in the list; the earlier (higher-ranked) one stays.
 * `searched` holds the shopper's own words (see modelToken).
 */
export function dedupeListings(
  ranked: AliProduct[],
  searched: ReadonlySet<string> = new Set(),
): AliProduct[] {
  const kept: { p: AliProduct; l: Listing }[] = [];
  for (const p of ranked) {
    const l = listing(p, searched);
    if (!kept.some((k) => isSameProduct(k.l, l))) kept.push({ p, l });
  }
  return kept.map((k) => k.p);
}

/**
 * Filters, ranks and removes duplicate listings. "cheapest" orders by price, then score. Commission
 * only breaks exact ties, and product id keeps the order deterministic after that. A worse
 * product never ranks higher because it pays more.
 */
export function rankProducts(
  products: AliProduct[],
  filters: SearchFilters,
  trust: TrustThresholds = FILTERS,
): AliProduct[] {
  const passed = products.filter((p) => passesFilters(p, filters, trust));
  if (!passed.length) return [];
  const ctx: ScoreContext = {
    sort: filters.sort_preference,
    priceRange: priceRange(passed.map((p) => p.price)),
  };
  const byPrice = filters.sort_preference === "cheapest";
  const scored = passed.map((p) => ({ p, s: score(p, ctx) }));
  scored.sort(
    (a, b) =>
      (byPrice ? a.p.price - b.p.price : 0) ||
      b.s - a.s ||
      (b.p.commissionRatePct ?? 0) - (a.p.commissionRatePct ?? 0) ||
      a.p.productId.localeCompare(b.p.productId),
  );
  const searched = [
    filters.keywords_en,
    ...filters.product_terms,
    ...filters.requirements.flatMap((r) => [r.en, ...r.alt]),
  ];
  return dedupeListings(
    scored.map((x) => x.p),
    new Set(tokenize(searched.join(" "))),
  );
}

export type TrustTier = "standard" | "fill";

/** Which trust thresholds a product meets, standard first. Null when it meets neither. */
export function trustTierOf(
  p: Pick<AliProduct, "positiveFeedbackPct" | "unitsSold">,
): TrustTier | null {
  const meets = (t: TrustThresholds) =>
    p.positiveFeedbackPct !== null &&
    p.positiveFeedbackPct >= t.minPositiveFeedbackPct &&
    p.unitsSold !== null &&
    p.unitsSold >= t.minUnitsSold;
  if (meets(FILTERS)) return "standard";
  if (meets(FILL_TIER)) return "fill";
  return null;
}

/**
 * Standard ranking, topped up to `target` results from FILL_TIER only when too few products meet
 * FILTERS. Standard products always come first; every other gate (price, type, requirements)
 * applies to both tiers unchanged.
 */
export function rankWithFill(
  products: AliProduct[],
  filters: SearchFilters,
  target: number,
): { ranked: AliProduct[]; fillIds: string[] } {
  const standard = rankProducts(products, filters);
  if (standard.length >= target) return { ranked: standard, fillIds: [] };
  const taken = new Set(standard.map((p) => p.productId));
  const extra = rankProducts(products, filters, FILL_TIER).filter((p) => !taken.has(p.productId));
  const searched = [
    filters.keywords_en,
    ...filters.product_terms,
    ...filters.requirements.flatMap((r) => [r.en, ...r.alt]),
  ];
  // Dedupe across tiers too, keeping the standard listing when two are the same product.
  const merged = dedupeListings([...standard, ...extra], new Set(tokenize(searched.join(" "))));
  const fill = merged.filter((p) => !taken.has(p.productId)).slice(0, target - standard.length);
  return { ranked: [...standard, ...fill], fillIds: fill.map((p) => p.productId) };
}
