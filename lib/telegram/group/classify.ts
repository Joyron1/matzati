// The second step of the search group's filter (filter.ts first): one short call to the cheap
// model asking whether a message is a request to find a product to buy. Output is a yes/no, a few
// tokens; about $0.0002 a message. Only messages the free rules let through get here. A failed
// call counts as a search (the search itself is the real check), so a model outage never deletes
// a real search.
import { z } from "zod";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";

export const CLASSIFY_SYSTEM = `You moderate a Hebrew Telegram group where people type what product they want to buy, and a bot answers with products from AliExpress.
Decide if the message is a request to find a product to buy: a product name or type, possibly with features, a budget, who it is for or what it is for ("אוזניות לריצה עד 100", "מתנה לאבא שאוהב לבשל", "כיסוי לאייפון 15", "משהו לארגן את המטבח").
Not a search: chat, greetings, thanks, opinions, jokes, questions about orders, shipping, customs, the group or the bot, complaints, advertising, spam, or anything offensive.
Answer with is_product_search only.`;

const schema = z.object({ is_product_search: z.boolean() });

export interface ClassifyOutcome {
  isSearch: boolean;
  usage: LlmUsage | null;
  model: string | null;
}

export async function isProductSearch(llm: LlmProvider, text: string): Promise<ClassifyOutcome> {
  try {
    const out = await llm.generateStructured({
      system: CLASSIFY_SYSTEM,
      user: text,
      schema,
      maxTokens: 50,
      timeoutMs: 8000,
      maxRetries: 1,
    });
    return { isSearch: out.data?.is_product_search ?? true, usage: out.usage, model: out.model };
  } catch {
    return { isSearch: true, usage: null, model: null };
  }
}
