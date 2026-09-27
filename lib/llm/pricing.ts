// USD per million tokens, from Anthropic's published pricing (checked 2026-09-27).
// Cache writes cost 1.25x input and cache reads 0.1x input.
import type { LlmUsage } from "./provider";

interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
};

export function priceFor(model: string): Price | undefined {
  // Dated ids like claude-haiku-4-5-20251001 share the family price.
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  return key ? PRICES[key] : undefined;
}

/** Cost of one call in USD, or null for a model we have no price for. */
export function costUsd(model: string, usage: LlmUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (
    (usage.inputTokens * p.input +
      usage.cacheWriteTokens * p.input * 1.25 +
      usage.cacheReadTokens * p.input * 0.1 +
      usage.outputTokens * p.output) /
    1_000_000
  );
}
