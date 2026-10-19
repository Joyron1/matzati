// The product finder's writer (owner request 2026-10-19): one LLM call writes a short Hebrew post
// and a one-line reason for each candidate, from the product's data only. Code checks every text
// (numbers grounded in the data, Hebrew, length) and falls back to a post built from the data.
import { z } from "zod";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { catalogByFirstLevel } from "@/lib/catalog/categories";
import { numbersAreGrounded } from "@/lib/llm/numbers";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import { hotTitle } from "@/lib/product-title";

export const POST_MIN = 40;
export const POST_MAX = 600;
export const WHY_MAX = 200;
/** Output cap: room for adaptive thinking on the larger models and 10 posts. */
export const WRITE_TOKENS = 6_000;

export const FINDER_SYSTEM = `You write short Hebrew posts for a Telegram channel of AliExpress deals, run by an Israeli shopping site.
For each product you get its machine-translated Hebrew title and its numbers. Write:
- post_he: 2 to 5 short lines in natural Hebrew, plural and gender-neutral ("שווה לבדוק", never singular address). First line: a short hook naming what the product is. Then what it is, only from the title (no invented features, specs, materials or uses). Then the price line and the trust line, with the numbers exactly as given (price in ₪, "במקום" the original price when given, the % positive feedback, the number sold in the last 30 days). At most two emoji. No hashtags, no links, no "הכי זול"/"הכי טוב"/"מומלץ ביותר" or any superlative, no urgency ("רק היום", "נגמר"), no promise of quality, shipping or delivery time.
- why_he: one sentence (up to 120 characters) for the site owner: why it is worth posting, from the numbers only.
Every number you write must appear in the product's data. Never mention commission.`;

const resultSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      post_he: z.string(),
      why_he: z.string(),
    }),
  ),
});

export interface WriterInput {
  id: string;
  title_he: string;
  category_he: string | null;
  price_ils: number;
  original_price_ils: number | null;
  discount_pct: number | null;
  positive_feedback_pct: number | null;
  units_sold_30d: number | null;
}

export function writerInput(p: AliProduct): WriterInput {
  return {
    id: p.productId,
    title_he: hotTitle(p.title),
    category_he: p.category.firstId
      ? (catalogByFirstLevel(p.category.firstId)?.nameHe ?? null)
      : null,
    price_ils: p.price,
    original_price_ils: p.originalPrice,
    discount_pct: p.discountPct,
    positive_feedback_pct: p.positiveFeedbackPct,
    units_sold_30d: p.unitsSold,
  };
}

const hebrew = /[֐-׿]/;
const formatIls = (n: number) => `₪${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** The post built from the data alone: what a candidate gets when the model's text fails a check. */
export function postFromData(i: WriterInput): string {
  const lines = [i.title_he];
  const price =
    i.original_price_ils !== null && i.original_price_ils > i.price_ils
      ? `${formatIls(i.price_ils)} במקום ${formatIls(i.original_price_ils)}`
      : formatIls(i.price_ils);
  lines.push(`💰 ${price}`);
  const trust = [
    i.positive_feedback_pct !== null ? `${i.positive_feedback_pct}% משוב חיובי` : null,
    i.units_sold_30d !== null
      ? `${i.units_sold_30d.toLocaleString("en-US")} נמכרו ב־30 הימים האחרונים`
      : null,
  ].filter(Boolean);
  if (trust.length) lines.push(`⭐ ${trust.join(" · ")}`);
  return lines.join("\n");
}

export function whyFromData(i: WriterInput): string {
  const parts = [
    i.units_sold_30d !== null ? `${i.units_sold_30d.toLocaleString("en-US")} מכירות בחודש` : null,
    i.positive_feedback_pct !== null ? `${i.positive_feedback_pct}% משוב חיובי` : null,
    i.discount_pct ? `${i.discount_pct}% הנחה` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "עבר את הסינון שלנו.";
}

/** A model text that holds: Hebrew, within its length, every number from the data. */
export function textHolds(text: string, input: WriterInput, min: number, max: number): boolean {
  const t = text.trim();
  return (
    t.length >= min &&
    t.length <= max &&
    hebrew.test(t) &&
    !/https?:\/\/|www\./i.test(t) &&
    !/עמלה/.test(t) &&
    numbersAreGrounded(t, input)
  );
}

export interface WrittenPost {
  post_he: string;
  why_he: string;
  /** The model's text failed a check (or no call was made): the post is built from the data. */
  fallback: boolean;
}

export interface WriteOutcome {
  posts: Map<string, WrittenPost>;
  usage: LlmUsage | null;
  model: string | null;
}

/**
 * Posts for `products`: one call to `llm` (null: no call, every post from the data, as when the
 * daily budget is out). A failed call also falls back to the data; it never fails the run.
 */
export async function writePosts(
  llm: LlmProvider | null,
  products: readonly AliProduct[],
): Promise<WriteOutcome> {
  const inputs = products.map(writerInput);
  const posts = new Map<string, WrittenPost>(
    inputs.map((i) => [i.id, { post_he: postFromData(i), why_he: whyFromData(i), fallback: true }]),
  );
  if (!llm || !inputs.length) return { posts, usage: null, model: null };
  try {
    const res = await llm.generateStructured({
      system: FINDER_SYSTEM,
      user: JSON.stringify({ products: inputs }),
      schema: resultSchema,
      maxTokens: WRITE_TOKENS,
      timeoutMs: 45_000,
      maxRetries: 1,
    });
    const byId = new Map(inputs.map((i) => [i.id, i]));
    for (const item of res.data?.items ?? []) {
      const input = byId.get(item.id);
      if (!input) continue;
      const postOk = textHolds(item.post_he, input, POST_MIN, POST_MAX);
      const whyOk = textHolds(item.why_he, input, 5, WHY_MAX);
      if (postOk) {
        posts.set(item.id, {
          post_he: item.post_he.trim(),
          why_he: whyOk ? item.why_he.trim() : whyFromData(input),
          fallback: false,
        });
      }
    }
    return { posts, usage: res.usage, model: res.model };
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[finder] writer failed, posts from the data: ${text.slice(0, 300)}`);
    return { posts, usage: null, model: null };
  }
}
