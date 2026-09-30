// Hebrew titles only, for the results the first view shows without a "why we picked it" line
// (places 6-10, RESULTS_FIRST_VIEW; owner decision 2026-09-30: a titles call instead of a second
// explain call, about $0.002 more per new search). Part of LLM job (b), CLAUDE.md §6.8: the model
// names each product from its English title; code checks and repairs every title exactly as it
// checks explain's (checkTitle in ./explain.ts).
import { z } from "zod";
import { checkTitle, HEBREW_SCRIPT_RULE, TITLE_RULE, type CopyProblem } from "./explain";
import type { LlmProvider, LlmUsage } from "./provider";

/**
 * Part of the results cache key (lib/search/cache-key.ts): bump it whenever the prompt or the
 * checks change. 1: the first titles call (2026-09-30).
 */
export const TITLES_VERSION = 1;

/**
 * What the model knows about the search: the Hebrew labels explain writes with, never the raw
 * query (the titles are cached with the result set for 14 days and shown to other shoppers).
 */
export interface TitlesContext {
  product_he: string;
  requirements_he: string[];
}

export interface TitlesInput {
  product_id: string;
  title_en: string;
}

// No .describe(): TITLES_SYSTEM covers the fields, and descriptions are paid input tokens.
export const titlesSchema = z.object({
  items: z.array(z.object({ id: z.string(), title_he: z.string() })),
});

export const TITLES_SYSTEM = `Write Hebrew product names for an Israeli shopping site. Return one item per input product, same id and order.

${TITLE_RULE}

The search tells you what the shopper looks for; name each product for what it is, not for the search. ${HEBREW_SCRIPT_RULE}

Example: search {"product_he":"מזרן יוגה","requirements_he":["נגד החלקה"]}, title_en "TPE Yoga Mat 6mm Non Slip" -> title_he "מזרן יוגה TPE 6mm".`;

/**
 * The output cap of one titles call: TITLES_TOKENS.base plus TITLES_TOKENS.perProduct per product
 * (608 for 5). A title of up to 60 Hebrew characters is about 30-40 output tokens with its JSON; a
 * cut-off answer is invalid JSON and every card of the call keeps AliExpress's title, so the cap
 * sits well above use. Tokens are paid as used, never by the cap.
 */
export const TITLES_TOKENS = { base: 128, perProduct: 96 } as const;

export interface Titled {
  product_id: string;
  /** Null when the model gave none or the checks rejected it: the card shows AliExpress's title. */
  title_he: string | null;
  /** For logs and evals only, never shown: what the model wrote when a check rejected it. */
  rejected?: { title_he?: string; title_problem: CopyProblem };
}

export interface TitlesResult {
  items: Titled[];
  usage: LlmUsage;
  model: string;
}

const NO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** A short id ("1", "2") instead of the 16-digit product id, as explain does. */
const shortId = (index: number) => String(index + 1);

/**
 * One call (temperature 0) for the products shown without a line. Returns one item per product, in
 * order; a product the model skipped or whose title fails the checks gets null.
 */
export async function titleProducts(
  llm: LlmProvider,
  context: TitlesContext,
  products: TitlesInput[],
): Promise<TitlesResult> {
  if (!products.length) return { items: [], usage: NO_USAGE, model: llm.model };
  const res = await llm.generateStructured({
    system: TITLES_SYSTEM,
    user: JSON.stringify({
      search: context,
      products: products.map((p, i) => ({ id: shortId(i), title_en: p.title_en })),
    }),
    schema: titlesSchema,
    maxTokens: TITLES_TOKENS.base + TITLES_TOKENS.perProduct * products.length,
    temperature: 0,
  });
  const byId = new Map<string, string>();
  for (const item of res.data?.items ?? []) {
    const id = item.id.trim();
    if (!byId.has(id)) byId.set(id, item.title_he);
  }
  const items = products.map((p, i): Titled => {
    const written = byId.get(shortId(i));
    if (written === undefined) {
      return { product_id: p.product_id, title_he: null, rejected: { title_problem: "missing" } };
    }
    const checked = checkTitle(written, p.title_en);
    return checked.problem
      ? {
          product_id: p.product_id,
          title_he: null,
          rejected: { title_he: written, title_problem: checked.problem },
        }
      : { product_id: p.product_id, title_he: checked.title_he };
  });
  return { items, usage: res.usage, model: res.model };
}
