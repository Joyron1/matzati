// One row in llm_usage per LLM call (supabase/migrations/phase2_stats.sql): which job made it,
// the model, the token counts the provider reported, and the cost in USD from lib/llm/pricing.
// Nothing about the query, the visitor or the output is stored.
import { costUsd } from "@/lib/llm/pricing";
import type { LlmUsage } from "@/lib/llm/provider";

/** The LLM jobs (CLAUDE.md §2): parse, explain (first page and "show more") and category tips. */
export const LLM_CALL_KINDS = ["parse", "explain", "explain_more", "tips"] as const;

export type LlmCallKind = (typeof LLM_CALL_KINDS)[number];

export interface LlmUsageRecord {
  kind: LlmCallKind;
  model: string;
  usage: LlmUsage;
}

/** An llm_usage row as inserted (id and created_at come from the database). */
export interface LlmUsageRow {
  kind: LlmCallKind;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** Null for a model without a known price: never guess a cost. */
  cost_usd: number | null;
}

// Token counts from the provider are whole numbers; a missing or broken one is stored as 0 rather
// than failing the insert (an int column rejects NaN and fractions).
const tokens = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** The column is numeric(10, 6). */
const roundUsd = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

export function usageRow({ kind, model, usage }: LlmUsageRecord): LlmUsageRow {
  const clean: LlmUsage = {
    inputTokens: tokens(usage.inputTokens),
    outputTokens: tokens(usage.outputTokens),
    cacheReadTokens: tokens(usage.cacheReadTokens),
    cacheWriteTokens: tokens(usage.cacheWriteTokens),
  };
  const usd = costUsd(model, clean);
  return {
    kind,
    model,
    input_tokens: clean.inputTokens,
    output_tokens: clean.outputTokens,
    cache_read_tokens: clean.cacheReadTokens,
    cache_write_tokens: clean.cacheWriteTokens,
    cost_usd: usd === null ? null : roundUsd(usd),
  };
}
