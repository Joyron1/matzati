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

post_he has three blocks, in this order, separated by an empty line (owner's format, 2026-10-24):
1. The product: a short excited hook line ending with "!!!" or an emoji (e.g. "מחיר מטורף!!!", "מציאה לבית 🏠"), then 2-3 lines saying what the product is, what it does for the buyer and who it is for, with its brand and main specs as the title names them, and a short call to action (e.g. "שווה לבדוק עכשיו 👇"). You may say prices on AliExpress change often; never invent scarcity or a deadline ("רק היום", "נשארו מעט") other than a coupon's end date as given.
2. The deal, each on its own line:
   - for each coupon given: "🎟️ קוד קופון: CODE" and what it gives as written, with its minimum order and end date when given (no coupon line when none is given);
   - when final_price_ils is given: "💰 מחיר סופי עם הקופון: ₪final_price_ils" and "במקום ₪original_price_ils" when given; otherwise "💰 מחיר: ₪price_ils", "במקום ₪original_price_ils" and the discount % when given;
   - when free_shipping_il is true: "🚚 משלוח חינם לישראל", plus the delivery days as given ("7-12 ימי משלוח לפי אלי אקספרס") when both are given;
   - then exactly the line "🔗 קישור לקנייה" (the link is added there automatically; never write a link).
3. Why it is worth it: 3 to 5 lines, each starting with "✅": a feature the title names, said as what it gives the buyer (a fleece lining keeps warm, a loop strap adjusts without holes); the last "✅" line may be the % positive feedback and how many were sold in the last 30 days. Use only features the title names; never invent a material, size, spec, use or result the title does not state.
Between 350 and 850 characters. No hashtags, no links, no "הכי זול"/"הכי טוב"/"מומלץ ביותר" or any superlative, no promise of quality; shipping and delivery only as block 2 states them.

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
  /** Shekels off, when the offer states a fixed amount we could read; else null. */
  off_ils?: number | null;
  /** Percent off, when the offer states one we could read; else null. */
  off_pct?: number | null;
}

/**
 * The amount an owner's coupon title states ("₪5 הנחה", "5 ש״ח הנחה", "10% הנחה"); nothing when it
 * states none we can read, so no final price is computed from it.
 */
export function ownerCouponAmount(title: string): {
  off_ils: number | null;
  off_pct: number | null;
} {
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(title);
  if (pct) return { off_ils: null, off_pct: Number(pct[1]) };
  const ils = /₪\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:₪|ש["״]ח|שקל)/.exec(title);
  if (ils && /הנחה|off/i.test(title)) return { off_ils: Number(ils[1] ?? ils[2]), off_pct: null };
  return { off_ils: null, off_pct: null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The price after the best single coupon that applies (the price meets its minimum and its amount or
 * percent is known), computed by code so the post's final price is never the model's arithmetic.
 * Null when no coupon applies.
 */
export function finalPrice(
  price: number,
  coupons: readonly CouponInfo[],
): { price: number; code: string } | null {
  let best: { price: number; code: string } | null = null;
  for (const c of coupons) {
    if (c.min_order_ils !== null && price < c.min_order_ils) continue;
    const after =
      c.off_ils != null && c.off_ils > 0 && c.off_ils < price
        ? price - c.off_ils
        : c.off_pct != null && c.off_pct > 0 && c.off_pct < 100
          ? price * (1 - c.off_pct / 100)
          : null;
    if (after !== null && (!best || after < best.price))
      best = { price: round2(after), code: c.code };
  }
  return best;
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
  /** product.shipping.get for the default variant: true only when its fee is 0. */
  free_shipping_il: boolean | null;
  delivery_days_min: number | null;
  delivery_days_max: number | null;
  /** The price after the best coupon that applies (finalPrice), or null. */
  final_price_ils: number | null;
  final_price_code: string | null;
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
    free_shipping_il: p.shipping ? p.shipping.feeIls === 0 : null,
    delivery_days_min: p.shipping?.minDays ?? null,
    delivery_days_max: p.shipping?.maxDays ?? null,
    ...(() => {
      const f = finalPrice(p.price, coupons);
      return { final_price_ils: f?.price ?? null, final_price_code: f?.code ?? null };
    })(),
  };
}

const hebrew = /[֐-׿]/;
const formatIls = (n: number) => `₪${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** The post built from the data alone: what a candidate gets when the model's text fails a check. */
export function postFromData(i: WriterInput): string {
  const product = [`🔥 ${i.title_he}`, "שווה לבדוק עכשיו 👇"];
  const deal: string[] = [];
  for (const c of i.coupons) {
    const terms = [
      c.min_order_ils !== null ? `בהזמנה מעל ${formatIls(c.min_order_ils)}` : null,
      c.ends ? `עד ${c.ends}` : null,
    ].filter(Boolean);
    deal.push(
      `🎟️ קוד קופון: ${c.code} · ${c.offer}${terms.length ? ` (${terms.join(", ")})` : ""}`,
    );
  }
  const was =
    i.original_price_ils !== null && i.original_price_ils > i.price_ils
      ? ` במקום ${formatIls(i.original_price_ils)}`
      : "";
  deal.push(
    i.final_price_ils !== null
      ? `💰 מחיר סופי עם הקופון: ${formatIls(i.final_price_ils)}${was}`
      : `💰 מחיר: ${formatIls(i.price_ils)}${was}${i.discount_pct ? ` (${i.discount_pct}% הנחה)` : ""}`,
  );
  if (i.free_shipping_il) {
    const days =
      i.delivery_days_min !== null && i.delivery_days_max !== null
        ? ` · ${i.delivery_days_min}-${i.delivery_days_max} ימי משלוח לפי אלי אקספרס`
        : "";
    deal.push(`🚚 משלוח חינם לישראל${days}`);
  }
  deal.push(BUY_LINK_LINE);
  const trust = [
    i.positive_feedback_pct !== null ? `${i.positive_feedback_pct}% משוב חיובי` : null,
    i.units_sold_30d !== null
      ? `${i.units_sold_30d.toLocaleString("en-US")} נמכרו ב־30 הימים האחרונים`
      : null,
  ].filter(Boolean);
  const blocks = [product.join("\n"), deal.join("\n")];
  if (trust.length) blocks.push(`✅ ${trust.join(" · ")}`);
  return blocks.join("\n\n");
}

/** The deal block's last line; the Telegram client puts the buy link there (withBuyLink). */
export const BUY_LINK_LINE = "🔗 קישור לקנייה";

/**
 * The post with the buy link on its "🔗" line (owner's format, 2026-10-24: the link in the text, as
 * well as the button). A post without that line gets it after its last "💰" line, else at the end.
 */
export function withBuyLink(post: string, url: string): string {
  const line = `🔗 לקנייה: ${url}`;
  const lines = post.split("\n");
  const at = lines.findIndex((l) => l.trim().startsWith("🔗"));
  if (at >= 0) {
    lines[at] = line;
    return lines.join("\n");
  }
  let price = -1;
  lines.forEach((l, i) => {
    if (l.trim().startsWith("💰")) price = i;
  });
  if (price >= 0) lines.splice(price + 1, 0, line);
  else lines.push(line);
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
