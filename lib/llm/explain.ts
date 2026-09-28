// Job (b): a clean Hebrew title and a one-line "why we picked it" per result, written only from
// the data we display (CLAUDE.md §6.8). Numbers and comparisons are post-checked in code.
import { z } from "zod";
import { formatCount, formatPct } from "@/lib/format";
import type { ParsedQuery, SortPreference } from "@/lib/search/filters";
import type { SharedNumbersMark } from "@/lib/types";
import { extractNumbers, numbersAreGrounded } from "./numbers";
import {
  comparisonSizes,
  fixSpelling,
  hasForeignScript,
  hasForeignWord,
  hasGarbledWord,
  hasMixedScript,
  isTruncated,
  mentionsBudget,
  superlativeClaims,
  tidyHebrew,
  usesSingularAddress,
  withoutForeignWords,
  writesPrice,
  type Superlative,
} from "./text-checks";
import type { LlmProvider, LlmUsage } from "./provider";

/**
 * Part of the results cache key: bump it whenever the prompt or the checks change. 5: the Hebrew
 * checks of docs/search-quality-plan.md A9 (Latin words, budget, repeated lines, spelling).
 */
export const EXPLAIN_VERSION = 5;

export const WHY_MAX = 120;
export const WHY_MIN = 25;
export const TITLE_MAX = 80;
/** Last resort when a product has neither trust metric (ranking never lets such a product through). */
export const WHY_TEMPLATE = "עבר את הסינון שלנו.";

/** Exactly the fields the UI shows. Nothing else reaches the model. */
export interface ExplainInput {
  product_id: string;
  title_en: string;
  price_ils: number;
  original_price_ils: number | null;
  discount_pct: number | null;
  positive_feedback_pct: number | null;
  units_sold_30d: number | null;
  /**
   * Its shop shows the same numbers on several listings (lib/ranking/shared-numbers.ts), and which
   * of this product's numbers other listings of the shop show too. A shared number is not this
   * product's own: the model never gets it, the line built from the data leaves it out, and no line
   * of its batch may compare trust numbers (best-selling, best-rated), since the shop's numbers are
   * not each product's own.
   */
  shared_numbers?: SharedNumbersMark;
}

/** The 30-day sales a line may state as this product's: none when other listings show them too. */
const ownSales = (p: ExplainInput) => (p.shared_numbers?.sales ? null : p.units_sold_30d);
/** The positive feedback a line may state as this product's: none when its shop repeats it. */
const ownFeedback = (p: ExplainInput) =>
  p.shared_numbers?.feedback ? null : p.positive_feedback_pct;

/**
 * What the model knows about the search. Never the raw query: explanations are cached for 14
 * days by filters and reused for other shoppers whose query parsed to the same filters.
 */
export interface ExplainContext {
  product_he: string;
  requirements_he: string[];
  min_price_ils?: number;
  max_price_ils?: number;
  sort_preference: SortPreference;
}

export function explainContextFrom(filters: ParsedQuery): ExplainContext {
  // Rounded like the cache key, so every shopper who shares the key shares the same context.
  const round = (n: number | undefined) => (n === undefined ? undefined : Math.round(n));
  const min = round(filters.min_price_ils);
  const max = round(filters.max_price_ils);
  // Spelled right even for a parse saved before normalizeParsed fixed the labels: the model copies
  // a typo it is given ("עמידות למיים", eval round 3) into every line.
  return {
    product_he: fixSpelling(filters.product_he),
    requirements_he: filters.requirements.map((r) => fixSpelling(r.he)),
    ...(min !== undefined ? { min_price_ils: min } : {}),
    ...(max !== undefined ? { max_price_ils: max } : {}),
    sort_preference: filters.sort_preference,
  };
}

// No .describe(): EXPLAIN_SYSTEM covers every field, and descriptions are paid input tokens.
export const explainSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title_he: z.string(),
      why_he: z.string(),
    }),
  ),
});

export const EXPLAIN_SYSTEM = `Write Hebrew copy for an Israeli shopping site. Return one item per input product, same id and order, even when sort_preference is "cheapest".

title_he (≤60 chars): what the product is, from title_en only; an accessory or part (replacement head, cover) is named as that item. Keep brands, models and specs exactly (IP67, 20000mAh), no unit conversion, no feature missing from title_en.

why_he: one sentence of 40-${WHY_MAX} chars ending with a period: how it fits the search, from the input data only.
- A feature only if title_en states it. End with "אבל הכותרת לא מציינת <requirement>" only for a requirements_he item title_en lacks; never about anything else.
- Partial fit (accessory, other item, one-model part): say so first ("אביזר משלים, לא המכשיר עצמו:").
- No price, budget or currency; "מתחת לתקציב שלכם" is fine if a budget was given.
- Trust data only as "<positive_feedback_pct>% משוב חיובי" and "<units_sold_30d> נמכרו ב־30 הימים האחרונים".
- At most two numbers, copied exactly, no rounding or arithmetic.
- Comparisons only when true in this input: "הזול", "הנמכר ביותר" or "המשוב החיובי הגבוה ביותר" + "מבין השלושה" ("מבין השניים" for two, none for one). No other superlatives (הכי טוב, משתלם, מושלם).
- No personal details (age, recipient, names): the line is reused for other shoppers.

Both fields: plural gender-neutral address (שלכם, תוכלו; never שלך, אתה). Natural Israeli Hebrew. Hebrew letters; Latin only for brands, models and specs, with a maqaf after a prefix (ב־4K). Abbreviations with ״ ׳ never ASCII quotes (ס״מ). No emoji or exclamation marks.

Example: search {"product_he":"מזרן יוגה","requirements_he":["נגד החלקה"]}, title_en "TPE Yoga Mat 6mm Non Slip", cheapest of three, 97.5% feedback -> title_he "מזרן יוגה TPE 6mm", why_he "מזרן נגד החלקה, 97.5% משוב חיובי והזול מבין השלושה."`;

export type CopyProblem =
  | "missing"
  | "empty"
  | "truncated"
  | "too_long"
  | "foreign_script"
  | "mixed_script"
  | "singular_address"
  | "price_written"
  | "ungrounded_number"
  | "false_superlative"
  /** "הכותרת לא מציינת ..." about something the search did not require, not at the end. */
  | "unrequested_caveat"
  /** A known garbled word or transliteration ("עצם הסיסמום"). */
  | "garbled_word"
  /** A Latin word that is not a brand, model or spec of title_en, or a brand after its "for". */
  | "foreign_word"
  /** "תקציב" when the shopper gave no budget ("מתחת לתקציב שלכם"). */
  | "unstated_budget"
  /** The same line as an earlier product of the batch, apart from its own trust numbers. */
  | "repeated_line";

export interface Explained {
  product_id: string;
  title_he: string | null;
  why_he: string;
  /** False when the model's line failed the checks and a sentence built from data was used. */
  why_from_model: boolean;
  /** For logs and evals only, never shown: what the model wrote when a check rejected it. */
  rejected?: {
    title_he?: string;
    title_problem?: CopyProblem;
    why_he?: string;
    why_problem?: CopyProblem;
  };
}

function productFacts(p: ExplainInput) {
  return {
    title_en: p.title_en,
    price_ils: p.price_ils,
    original_price_ils: p.original_price_ils,
    discount_pct: p.discount_pct,
    positive_feedback_pct: ownFeedback(p),
    units_sold_30d: ownSales(p),
  };
}

/** The product as the model sees it: a short id ("1", "2", "3") instead of the 16-digit id. */
function modelProduct(p: ExplainInput, id: string) {
  return { id, ...productFacts(p) };
}

const shortId = (index: number) => String(index + 1);

/** True when `value` is the best of the batch (ties count), so "הזול מבין השלושה" holds. */
function isBest(value: number | null, all: (number | null)[], pick: (...n: number[]) => number) {
  const known = all.filter((v): v is number => v !== null);
  return value !== null && value === pick(...known);
}

function claimHolds(claim: Superlative, p: ExplainInput, batch: readonly ExplainInput[]): boolean {
  if (batch.length < 2) return false;
  const all = <K extends keyof ExplainInput>(key: K) => batch.map((b) => b[key]);
  // A shared number is not its product's own: no trust comparison holds in its batch.
  const ownTrust = batch.every((b) => !b.shared_numbers);
  switch (claim) {
    case "cheapest":
      return isBest(p.price_ils, all("price_ils"), Math.min);
    case "most_sold":
      return ownTrust && isBest(p.units_sold_30d, all("units_sold_30d"), Math.max);
    case "top_feedback":
      return ownTrust && isBest(p.positive_feedback_pct, all("positive_feedback_pct"), Math.max);
    case "top_discount":
      return isBest(p.discount_pct, all("discount_pct"), Math.max);
    case "unverifiable":
      return false;
  }
}

function whyProblem(
  why: string,
  p: ExplainInput,
  batch: readonly ExplainInput[],
  context: ExplainContext,
): CopyProblem | null {
  if (!why) return "empty";
  if (isTruncated(why, WHY_MIN)) return "truncated";
  if (why.length > WHY_MAX) return "too_long";
  if (hasForeignScript(why)) return "foreign_script";
  if (hasMixedScript(why)) return "mixed_script";
  if (hasGarbledWord(why)) return "garbled_word";
  if (hasForeignWord(why, p.title_en)) return "foreign_word";
  if (usesSingularAddress(why)) return "singular_address";
  if (writesPrice(why)) return "price_written";
  if (mentionsBudget(why) && context.max_price_ils === undefined) return "unstated_budget";
  // Only this product's facts and the budget: never another product's numbers or the raw query.
  // Its prices are left out too, so a bare "27.31" cannot contradict the card's rounded "≈₪27",
  // and so are numbers other listings of its shop show too (ownFeedback, ownSales).
  const facts = {
    title_en: p.title_en,
    discount_pct: p.discount_pct,
    positive_feedback_pct: ownFeedback(p),
    units_sold_30d: ownSales(p),
  };
  const grounding = [facts, context.min_price_ils, context.max_price_ils];
  if (!numbersAreGrounded(why, grounding)) return "ungrounded_number";
  if (!superlativeClaims(why).every((c) => claimHolds(c, p, batch))) return "false_superlative";
  // "הזול מבין השלושה" is false when only two products were shown.
  if (comparisonSizes(why).some((n) => n !== batch.length)) return "false_superlative";
  return null;
}

function titleProblem(title: string, p: ExplainInput): CopyProblem | null {
  if (!title) return "empty";
  if (title.length > TITLE_MAX) return "too_long";
  if (hasForeignScript(title)) return "foreign_script";
  if (hasMixedScript(title)) return "mixed_script";
  if (hasGarbledWord(title)) return "garbled_word";
  // What is left once the Latin words were dropped must still be a Hebrew name.
  if (!/[א-ת]{2}/.test(title) || hasForeignWord(title, p.title_en)) return "foreign_word";
  // Numbers in the title must come from the original title (model names, specs).
  if (!numbersAreGrounded(title, p.title_en, [])) return "ungrounded_number";
  return null;
}

export interface CheckedCopy {
  title_he: string | null;
  why_he: string | null;
  title_problem: CopyProblem | null;
  why_problem: CopyProblem | null;
}

const CAVEAT = /ו?הכותרת\s+(?:לא|אינה)\s+מציינת\s+/;
/** The caveat as the line's last clause, with its lead-in: ", אבל הכותרת לא מציינת ידית הרכבה." */
const TRAILING_CAVEAT =
  /(?:[,;]\s*|\s+)?(?:(?:ו?אבל|אך)\s+)?ו?הכותרת\s+(?:לא|אינה)\s+מציינת\s+[^.,;:]+\.?\s*$/;
/** Words that say nothing about which requirement a caveat names. */
const FUNCTION_WORDS = new Set([
  "עם",
  "ללא",
  "בלי",
  "נגד",
  "של",
  "את",
  "או",
  "גם",
  "לא",
  "כל",
  "על",
]);

/**
 * A text's words, each also without up to two one-letter prefixes, so "עמידות למים" and "עמידות
 * במים" share "מים". Forms shorter than 3 letters are dropped ("ים" would match "לים").
 */
function wordForms(text: string): Set<string> {
  const forms = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (FUNCTION_WORDS.has(word)) continue;
    let w = word;
    for (let k = 0; k <= 2 && w.length >= 3; k++) {
      forms.add(w);
      if (!/^[ובהלמשכ]/.test(w)) break;
      w = w.slice(1);
    }
  }
  return forms;
}

/**
 * "הכותרת לא מציינת X" may only name a requirement the search stated (requirements_he), never
 * a feature nobody asked for ("ידית הרכבה"). Such a caveat is cut off when it is the last clause;
 * anywhere else the line fails with "unrequested_caveat".
 */
function withoutUnrequestedCaveat(
  why: string,
  requirements: readonly string[],
): { why: string; cut: boolean; problem: CopyProblem | null } {
  const found = CAVEAT.exec(why);
  if (!found) return { why, cut: false, problem: null };
  const named = wordForms(why.slice(found.index + found[0].length).split(/[.,;:]/)[0]);
  if (requirements.some((r) => [...wordForms(r)].some((f) => named.has(f)))) {
    return { why, cut: false, problem: null };
  }
  const trailing = TRAILING_CAVEAT.exec(why);
  // Only the caveat just checked may be cut: a later one ("..., אבל הכותרת לא מציינת עמידות
  // למים.") may be the requested caveat, and cutting it would keep the unrequested one.
  if (!trailing || trailing.index > found.index) {
    return { why, cut: false, problem: "unrequested_caveat" };
  }
  const rest = why.slice(0, trailing.index).replace(/[\s,;:־-]+$/, "");
  return { why: rest ? `${rest}.` : "", cut: true, problem: null };
}

/** Checks one item against its product and the batch it was written with (for comparisons). */
export function checkExplanation(
  item: { title_he: string; why_he: string },
  p: ExplainInput,
  batch: readonly ExplainInput[],
  context: ExplainContext,
): CheckedCopy {
  const caveat = withoutUnrequestedCaveat(tidyHebrew(item.why_he.trim()), context.requirements_he);
  const why = caveat.why;
  // A Latin word that is not a brand, model or spec is dropped rather than failing the title,
  // which would show the English title_en instead ("מארגן מגירות Expandable" → "מארגן מגירות").
  const written = tidyHebrew(item.title_he.trim());
  const title = withoutForeignWords(written, p.title_en);
  let wp = caveat.problem ?? whyProblem(why, p, batch, context);
  // Too little left after our own cut is not a line the model cut off, so the title stays.
  if (caveat.cut && (wp === "empty" || wp === "truncated")) wp = "unrequested_caveat";
  // A cut-off line usually means the title was cut at the same ASCII quote ("מארגן סכו").
  const tp =
    wp === "truncated"
      ? "truncated"
      : written && !title
        ? "foreign_word" // nothing but Latin words that are not names
        : titleProblem(title, p);
  return {
    title_he: tp ? null : title,
    why_he: wp ? null : why,
    title_problem: tp,
    why_problem: wp,
  };
}

/**
 * The fallback line, built only from API data so it is always true:
 * "98% משוב חיובי ו־3,412 נמכרו ב־30 הימים האחרונים." A number other listings of its shop show
 * too is left out (shared_numbers): it is not this product's achievement. With neither number of
 * its own, the line says only that it passed (WHY_TEMPLATE).
 */
export function whyFromData(p: ExplainInput): string {
  const pct = ownFeedback(p);
  const feedback = pct === null ? null : `${formatPct(pct)} משוב חיובי`;
  const units = ownSales(p);
  const sold = units === null ? null : `${formatCount(units)} נמכרו ב־30 הימים האחרונים`;
  if (feedback && sold) return `${feedback} ו־${sold}.`;
  if (feedback || sold) return `${feedback ?? sold}.`;
  return WHY_TEMPLATE;
}

function explainOne(
  out: { title_he: string; why_he: string } | undefined,
  p: ExplainInput,
  batch: readonly ExplainInput[],
  context: ExplainContext,
): Explained {
  if (!out) {
    return {
      product_id: p.product_id,
      title_he: null,
      why_he: whyFromData(p),
      why_from_model: false,
      rejected: { title_problem: "missing", why_problem: "missing" },
    };
  }
  const c = checkExplanation(out, p, batch, context);
  const rejected =
    c.title_problem || c.why_problem
      ? {
          ...(c.title_problem ? { title_he: out.title_he, title_problem: c.title_problem } : {}),
          ...(c.why_problem ? { why_he: out.why_he, why_problem: c.why_problem } : {}),
        }
      : undefined;
  return {
    product_id: p.product_id,
    title_he: c.title_he,
    why_he: c.why_he ?? whyFromData(p),
    why_from_model: c.why_he !== null,
    ...(rejected ? { rejected } : {}),
  };
}

/** The line without this product's trust numbers, so lines of different products compare. */
function lineShape(why: string, p: ExplainInput): string {
  const own = new Set(
    [p.positive_feedback_pct, p.units_sold_30d].flatMap((n) =>
      n === null ? [] : extractNumbers(String(n)),
    ),
  );
  return why
    .replace(/\d+(?:[.,]\d+)*/g, (raw) => (own.has(extractNumbers(raw)[0]) ? "#" : raw))
    .replace(/[\s,.;:־-]+/g, " ")
    .trim();
}

/**
 * The same line under two products of one list says nothing about either (the live site showed
 * two identical lines, eval round 3 three): a line equal to an earlier one once each product's own
 * trust numbers are set aside falls back to data. A spec number stays part of the line, so "10000
 * מיליאמפר" and "20000 מיליאמפר" differ.
 */
export function withoutRepeatedLines(
  items: Explained[],
  products: readonly ExplainInput[],
): Explained[] {
  const byId = new Map(products.map((p) => [p.product_id, p]));
  const seen = new Set<string>();
  return items.map((item) => {
    const p = byId.get(item.product_id);
    if (!item.why_from_model || !p) return item;
    const shape = lineShape(item.why_he, p);
    if (!seen.has(shape)) {
      seen.add(shape);
      return item;
    }
    return {
      ...item,
      why_he: whyFromData(p),
      why_from_model: false,
      rejected: { ...item.rejected, why_he: item.why_he, why_problem: "repeated_line" },
    };
  });
}

export interface ExplainResult {
  items: Explained[];
  usage: LlmUsage;
  model: string;
}

const NO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** One call for the batch shown together (up to 3). Returns one item per product, in order. */
export async function explainProducts(
  llm: LlmProvider,
  context: ExplainContext,
  products: ExplainInput[],
): Promise<ExplainResult> {
  if (!products.length) return { items: [], usage: NO_USAGE, model: llm.model };
  const res = await llm.generateStructured({
    system: EXPLAIN_SYSTEM,
    user: JSON.stringify({
      search: context,
      products: products.map((p, i) => modelProduct(p, shortId(i))),
    }),
    schema: explainSchema,
    maxTokens: 1024,
  });
  const byId = new Map<string, { title_he: string; why_he: string }>();
  for (const item of res.data?.items ?? []) {
    const id = item.id.trim();
    if (!byId.has(id)) byId.set(id, item);
  }
  const items = products.map((p, i) => explainOne(byId.get(shortId(i)), p, products, context));
  return { items: withoutRepeatedLines(items, products), usage: res.usage, model: res.model };
}
