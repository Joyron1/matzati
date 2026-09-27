import { describe, expect, it } from "vitest";
import { costUsd } from "@/lib/llm/pricing";
import { LLM_CALL_KINDS, usageRow } from "./usage";

const usage = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("usageRow", () => {
  it("maps a call to llm_usage columns with the cost from lib/llm/pricing", () => {
    expect(usageRow({ kind: "parse", model: "claude-haiku-4-5-20251001", usage })).toEqual({
      kind: "parse",
      model: "claude-haiku-4-5-20251001",
      input_tokens: 900,
      output_tokens: 100,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: costUsd("claude-haiku-4-5-20251001", usage),
    });
  });

  it("prices cache reads and writes and rounds to the column's 6 decimals", () => {
    const row = usageRow({
      kind: "tips",
      model: "claude-haiku-4-5",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 3, cacheWriteTokens: 5 },
    });
    // (1 + 5 * 1.25 + 3 * 0.1) * $1 + 1 * $5 = $12.55 per million tokens
    expect(row.cost_usd).toBe(0.000013);
  });

  it("stores no cost for a model without a known price", () => {
    expect(usageRow({ kind: "explain", model: "mystery-model", usage }).cost_usd).toBeNull();
  });

  it("stores broken token counts as 0 so the insert never fails", () => {
    const row = usageRow({
      kind: "explain_more",
      model: "claude-haiku-4-5",
      usage: {
        inputTokens: Number.NaN,
        outputTokens: -4,
        cacheReadTokens: 2.6,
        cacheWriteTokens: Infinity,
      },
    });
    expect(row).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 3,
      cache_write_tokens: 0,
    });
    expect(Number.isFinite(row.cost_usd)).toBe(true);
  });

  it("knows exactly the kinds the llm_usage check constraint allows", () => {
    expect([...LLM_CALL_KINDS]).toEqual(["parse", "explain", "explain_more", "tips"]);
  });
});
