// Job (b): a clean Hebrew title and a one-line "why we picked it" per result, written only from
// the data we display (CLAUDE.md §6.8). Numbers and comparisons are post-checked in code.
import { z } from "zod";
import { formatCount, formatPct } from "@/lib/format";
import type { ParsedQuery, SortPreference } from "@/lib/search/filters";
import { numbersAreGrounded } from "./numbers";
import {
  comparisonSizes,
  hasForeignScript,
  hasMixedScript,
  isTruncated,
  superlativeClaims,
  tidyHebrew,
  usesSingularAddress,
  writesPrice,
  type Superlative,
} from "./text-checks";
import type { LlmProvider, LlmUsage } from "./provider";

/** Part of the results cache key: bump it whenever the prompt or the checks change. */
export const EXPLAIN_VERSION = 2;

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
}

/**
 * What the model knows about the search. Never the raw query: explanations are cached for 48h
 * by filters and reused for other shoppers whose query parsed to the same filters.
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
  return {
    product_he: filters.product_he,
    requirements_he: filters.requirements.map((r) => r.he),
    ...(min !== undefined ? { min_price_ils: min } : {}),
    ...(max !== undefined ? { max_price_ils: max } : {}),
    sort_preference: filters.sort_preference,
  };
}

export const explainSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().describe("The product's id from the input"),
      title_he: z.string(),
      why_he: z.string(),
    }),
  ),
});

export const EXPLAIN_SYSTEM = `You write short Hebrew copy for an Israeli shopping site. The input JSON has "search" (the shopper's filters: product_he, requirements_he, an optional budget min_price_ils / max_price_ils, and sort_preference) and "products" (up to 3, each with a short id and the fields shown on its card). Return exactly one item for every product in the input, in the same order and with the same id, even when sort_preference is "cheapest".

title_he: a short, natural Hebrew name for what the product actually is, at most 60 characters.
- Base it only on title_en. If title_en shows an accessory or part (a replacement head, a protective cover, a refill, a mounting bracket), name that item, not the product it belongs to.
- Keep brand names, model names and specs exactly as written (IP67, 20000mAh, 1080P, M8, 1.5M). Do not convert units.
- Never add a feature that is not in title_en, even if the search asked for it.

why_he: one complete Hebrew sentence of 40 to ${WHY_MAX} characters, ending with a period, saying how this product fits the search.
- State a feature only if title_en states it. If the search asked for something title_en does not mention, do not claim it; end with "אבל הכותרת לא מציינת <the feature>".
- If the product only partly fits (an accessory, a different item, a part that fits one model only), say so at the start, for example "אביזר משלים, לא המכשיר עצמו:".
- Do not write the price or the budget, and never write ₪, ש״ח or שקל; the card shows the price. You may write "מתחת לתקציב שלכם" when a budget was given.
- Trust data only in these exact forms: "<positive_feedback_pct>% משוב חיובי" and "<units_sold_30d> נמכרו ב־30 הימים האחרונים". Never "ביקורות", "דירוג", "הערכה" or "בחודש".
- Numbers: at most two, copied digit for digit from the input. No rounding, no arithmetic, no differences, no unit conversions.
- Comparisons only when true across the products in this input, phrased with "מבין השלושה" (or "מבין השניים"): "הזול מבין השלושה", "הנמכר ביותר מבין השלושה", "המשוב החיובי הגבוה ביותר מבין השלושה". No comparisons when there is only one product. Never "הכי טוב", "משתלם", "מושלם", "לכל" or "אוניברסלי" unless title_en says universal.
- Do not repeat personal details (age, who it is for, names). The same line is shown to other shoppers whose search had the same filters.

Hebrew style for both fields:
- Plural, gender-neutral address: "שלכם", "לכם", "תוכלו". Never "שלך", "לך", "אתה", "תוכל".
- Natural Israeli Hebrew, not word-for-word translation: "נירוסטה" (not "פלדה ללא כתמים"), "חזק ועמיד" for heavy duty (not "חובה כבדה"), "נגד אדים" for anti-fog (not "אנטי ערפל"), "עמיד בפני שריטות" (not "התנגדות לשריטות").
- Hebrew letters only; Latin only for brand names, model names and specs. Put a maqaf between a one-letter Hebrew prefix and Latin or digits: "ו־HDMI", "ב־4K".
- In abbreviations use the Hebrew marks ״ and ׳, never the ASCII characters " or ': "ס״מ", "מ״ל", "ק״ג".
- No emoji, no exclamation marks.

Examples:
search {"product_he":"מזרן יוגה","requirements_he":["נגד החלקה"]}, title_en "TPE Yoga Mat 6mm Non Slip Double Layer Fitness Exercise Pad With Carry Strap" (the cheapest of three, 97.5% feedback) -> title_he "מזרן יוגה TPE דו־שכבתי 6mm", why_he "מזרן דו־שכבתי נגד החלקה עם רצועת נשיאה, 97.5% משוב חיובי והזול מבין השלושה."
search {"product_he":"מברשת לכלבים ארוכי שיער"}, title_en "Pet Grooming Brush Self Cleaning Slicker Brush for Dogs Cats Hair Removal Comb" -> title_he "מברשת טיפוח לכלבים וחתולים", why_he "מברשת טיפוח לכלבים וחתולים עם ניקוי עצמי, אבל הכותרת לא מציינת התאמה לשיער ארוך."
search {"product_he":"מברשת שיניים חשמלית"}, title_en "4pcs Replacement Brush Heads Compatible with Oral-B Electric Toothbrush Soft Bristles" -> title_he "4 ראשי החלפה למברשת שיניים חשמלית Oral-B", why_he "אביזר משלים, לא המברשת עצמה: 4 ראשי החלפה רכים שמתאימים למברשות Oral-B."`;

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
  | "false_superlative";

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
    positive_feedback_pct: p.positive_feedback_pct,
    units_sold_30d: p.units_sold_30d,
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
  switch (claim) {
    case "cheapest":
      return isBest(p.price_ils, all("price_ils"), Math.min);
    case "most_sold":
      return isBest(p.units_sold_30d, all("units_sold_30d"), Math.max);
    case "top_feedback":
      return isBest(p.positive_feedback_pct, all("positive_feedback_pct"), Math.max);
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
  if (usesSingularAddress(why)) return "singular_address";
  if (writesPrice(why)) return "price_written";
  // Only this product's facts and the budget: never another product's numbers or the raw query.
  // Its prices are left out too, so a bare "27.31" cannot contradict the card's rounded "≈₪27".
  const { title_en, discount_pct, positive_feedback_pct, units_sold_30d } = p;
  const facts = { title_en, discount_pct, positive_feedback_pct, units_sold_30d };
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

/** Checks one item against its product and the batch it was written with (for comparisons). */
export function checkExplanation(
  item: { title_he: string; why_he: string },
  p: ExplainInput,
  batch: readonly ExplainInput[],
  context: ExplainContext,
): CheckedCopy {
  const why = tidyHebrew(item.why_he.trim());
  const title = tidyHebrew(item.title_he.trim());
  const wp = whyProblem(why, p, batch, context);
  // A cut-off line usually means the title was cut at the same ASCII quote ("מארגן סכו").
  const tp = wp === "truncated" ? "truncated" : titleProblem(title, p);
  return {
    title_he: tp ? null : title,
    why_he: wp ? null : why,
    title_problem: tp,
    why_problem: wp,
  };
}

/**
 * The fallback line, built only from API data so it is always true:
 * "98% משוב חיובי ו־3,412 נמכרו ב־30 הימים האחרונים."
 */
export function whyFromData(p: ExplainInput): string {
  const feedback =
    p.positive_feedback_pct === null ? null : `${formatPct(p.positive_feedback_pct)} משוב חיובי`;
  const sold =
    p.units_sold_30d === null ? null : `${formatCount(p.units_sold_30d)} נמכרו ב־30 הימים האחרונים`;
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
  return { items, usage: res.usage, model: res.model };
}
