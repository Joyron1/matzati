// The product finder's writer (owner requests 2026-10-19 and 10-23): one LLM call writes a selling
// Hebrew Telegram post and a one-line reason for each candidate, from the product's data only: its
// title (AliExpress gives affiliates no description, so the benefits come from the features the
// title names), price, discount, feedback, sales, and the coupons valid for it (AliExpress's own
// promo code and the owner's coupons). Code checks every text (numbers grounded in the data,
// Hebrew, length, no link, no commission) and falls back to a post built from the data.
import { z } from "zod";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { catalogByFirstLevel } from "@/lib/catalog/categories";
import { numbersAreGrounded } from "@/lib/llm/numbers";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import { hotTitle } from "@/lib/product-title";

export const POST_MIN = 120;
/** Telegram's caption limit is 1,024 with the disclosure the client adds (lib/telegram/client.ts). */
export const POST_MAX = 900;
export const WHY_MAX = 200;
/** Products per writer call; the calls of a run go in parallel, so a run stays within 60 s. */
export const WRITE_BATCH = 3;
/** Output cap of one call: room for adaptive thinking on the larger models and 3 posts. */
export const WRITE_TOKENS = 5_000;

export const FINDER_SYSTEM = `You are the copywriter of an Israeli Telegram channel of AliExpress deals. For each product you get its machine-translated Hebrew title (it lists the product's features), its numbers and the coupons valid for it. Write a post that makes people want to buy it now, in natural, lively, fluent Hebrew (fix the machine translation's wording), plural and gender-neutral (never singular address).

post_he, in this order, each part on its own line(s):
1. A hook: one punchy line with an emoji, naming what the product is and the problem it solves or who it is for.
2. Two to four benefit lines, each starting with "✅": a feature the title names and what it gives the buyer in plain words (a fleece lining keeps warm, a loop strap adjusts without holes). Use only features the title names; never invent a material, size, spec, use or result the title does not state.
3. The price line starting with "💰": the price in ₪, "במקום" the original price when given, and the discount % when given.
4. For each coupon given, a line starting with "🎟️": "קוד קופון: CODE" and what it gives as written, with its minimum order and end date when given. No coupon line when no coupon is given.
5. The social-proof line starting with "⭐": the % positive feedback and how many were sold in the last 30 days.
6. A strong call to action starting with "👇", sending them to the "לקנייה באלי אקספרס" button below (for example "לחצו על ״לקנייה באלי אקספרס״ כאן למטה ובדקו את המחיר עכשיו"). You may say that prices on AliExpress change often; never invent scarcity or a deadline ("רק היום", "נשארו מעט", "אחרונים") other than a coupon's end date as given.
Between 300 and 850 characters. No hashtags, no links, no "הכי זול"/"הכי טוב"/"מומלץ ביותר" or any superlative, no promise of quality, shipping or delivery time.

why_he: one sentence (up to 120 characters) for the site owner: why it is worth posting, from the numbers only.

Every number you write (prices, percents, counts, sizes, dates) must appear in the product's data. Never mention commission.`;

const resultSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      post_he: z.string(),
      why_he: z.string(),
    }),
  ),
});

/** A coupon valid for the product: AliExpress's promo code or one of the owner's coupons. */
export interface CouponInfo {
  code: string;
  /** What it gives, as written (AliExpress's offer text, or the owner's Hebrew title). */
  offer: string;
  min_order_ils: number | null;
  /** "dd.mm" in Israel time, or null when it has no end. */
  ends: string | null;
}

export interface WriterInput {
  id: string;
  title_he: string;
  category_he: string | null;
  price_ils: number;
  original_price_ils: number | null;
  discount_pct: number | null;
  positive_feedback_pct: number | null;
  units_sold_30d: number | null;
  coupons: CouponInfo[];
}

export function writerInput(p: AliProduct, coupons: CouponInfo[] = []): WriterInput {
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
    coupons,
  };
}

const hebrew = /[֐-׿]/;
const formatIls = (n: number) => `₪${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** The post built from the data alone: what a candidate gets when the model's text fails a check. */
export function postFromData(i: WriterInput): string {
  const lines = [`🔥 ${i.title_he}`];
  const price =
    i.original_price_ils !== null && i.original_price_ils > i.price_ils
      ? `${formatIls(i.price_ils)} במקום ${formatIls(i.original_price_ils)}`
      : formatIls(i.price_ils);
  lines.push(`💰 ${price}${i.discount_pct ? ` (${i.discount_pct}% הנחה)` : ""}`);
  for (const c of i.coupons) {
    const terms = [
      c.min_order_ils !== null ? `בהזמנה מעל ${formatIls(c.min_order_ils)}` : null,
      c.ends ? `עד ${c.ends}` : null,
    ].filter(Boolean);
    lines.push(
      `🎟️ קוד קופון: ${c.code} · ${c.offer}${terms.length ? ` (${terms.join(", ")})` : ""}`,
    );
  }
  const trust = [
    i.positive_feedback_pct !== null ? `${i.positive_feedback_pct}% משוב חיובי` : null,
    i.units_sold_30d !== null
      ? `${i.units_sold_30d.toLocaleString("en-US")} נמכרו ב־30 הימים האחרונים`
      : null,
  ].filter(Boolean);
  if (trust.length) lines.push(`⭐ ${trust.join(" · ")}`);
  lines.push("👇 לפרטים ולקנייה: ״לקנייה באלי אקספרס״ כאן למטה");
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

/** One writer call for a few products; its posts that hold go into `posts`. */
async function writeBatch(
  llm: LlmProvider,
  inputs: WriterInput[],
  posts: Map<string, WrittenPost>,
): Promise<{ usage: LlmUsage; model: string } | null> {
  try {
    const res = await llm.generateStructured({
      system: FINDER_SYSTEM,
      user: JSON.stringify({ products: inputs }),
      schema: resultSchema,
      maxTokens: WRITE_TOKENS,
      timeoutMs: 40_000,
      maxRetries: 1,
    });
    const byId = new Map(inputs.map((i) => [i.id, i]));
    for (const item of res.data?.items ?? []) {
      const input = byId.get(item.id);
      if (!input) continue;
      if (textHolds(item.post_he, input, POST_MIN, POST_MAX)) {
        const whyOk = textHolds(item.why_he, input, 5, WHY_MAX);
        posts.set(item.id, {
          post_he: item.post_he.trim(),
          why_he: whyOk ? item.why_he.trim() : whyFromData(input),
          fallback: false,
        });
      } else {
        console.error(`[finder] post for ${item.id} failed a check; from the data instead`);
      }
    }
    return { usage: res.usage, model: res.model };
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[finder] writer call failed, posts from the data: ${text.slice(0, 300)}`);
    return null;
  }
}

/**
 * Posts for `products`: writer calls of WRITE_BATCH products each, in parallel (null `llm`: no
 * call, every post from the data, as when the daily budget is out). `coupons` by product id. A
 * failed call leaves its products' posts from the data; it never fails the run. The usage of every
 * call is summed (one model).
 */
export async function writePosts(
  llm: LlmProvider | null,
  products: readonly AliProduct[],
  coupons: ReadonlyMap<string, CouponInfo[]> = new Map(),
): Promise<WriteOutcome> {
  const inputs = products.map((p) => writerInput(p, coupons.get(p.productId) ?? []));
  const posts = new Map<string, WrittenPost>(
    inputs.map((i) => [i.id, { post_he: postFromData(i), why_he: whyFromData(i), fallback: true }]),
  );
  if (!llm || !inputs.length) return { posts, usage: null, model: null };
  const batches: WriterInput[][] = [];
  for (let i = 0; i < inputs.length; i += WRITE_BATCH)
    batches.push(inputs.slice(i, i + WRITE_BATCH));
  const results = (await Promise.all(batches.map((b) => writeBatch(llm, b, posts)))).filter(
    (r): r is { usage: LlmUsage; model: string } => r !== null,
  );
  if (!results.length) return { posts, usage: null, model: null };
  const usage = results.reduce<LlmUsage>(
    (sum, r) => ({
      inputTokens: sum.inputTokens + r.usage.inputTokens,
      outputTokens: sum.outputTokens + r.usage.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + r.usage.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + r.usage.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
  return { posts, usage, model: results[0].model };
}
