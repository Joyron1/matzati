// Usage recording in the category tips job (lib/tips/refresh.ts): kind "tips", recorded even when
// the output is unusable, and a recording failure never fails the job.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import type { TipsCategory } from "@/lib/tips/category";
import { TipsRefresher, type TipsJobDeps } from "@/lib/tips/refresh";
import type { LlmUsageRecord } from "./usage";

vi.mock("server-only", () => ({}));

const USAGE: LlmUsage = {
  inputTokens: 700,
  outputTokens: 250,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
const GOOD = [
  "בדקו שהחיבור לטעינה הוא USB-C, כדי שתוכלו להשתמש באותו כבל של הטלפון.",
  "חפשו עמידות למים לפי תקן מוגדר כמו IPX7, ולא רק את המילה עמיד.",
  "קראו מה כלול באריזה לפני ההזמנה, כי חלק מהאביזרים נמכרים בנפרד.",
];
const WATCHES: TipsCategory = { id: "1511", nameEn: "Watches", parentEn: null };

/** category_tips with nothing stored yet; writes are accepted and reported to onWrite. */
function emptyDb(onWrite: () => void = () => {}): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async () => {
      onWrite();
      return { data: null, error: null };
    },
  };
  return { from: () => query } as unknown as SupabaseClient;
}

function llm(data: unknown): LlmProvider {
  return {
    name: "anthropic",
    model: "claude-haiku-4-5",
    generateStructured: async (req) => ({
      data: data === null ? null : req.schema.parse(data),
      usage: USAGE,
      model: "claude-haiku-4-5-20251001",
    }),
  };
}

function run(
  data: unknown,
  recordUsage: TipsJobDeps["recordUsage"],
  budget = true,
): Promise<string[]> {
  const logs: string[] = [];
  const refresher = new TipsRefresher({ log: (m) => logs.push(m) });
  return refresher
    .refresh(WATCHES, () => ({
      db: emptyDb(),
      llm: llm(data),
      chargeBudget: async () => budget,
      recordUsage,
    }))
    .then(() => logs);
}

describe("tips usage recording", () => {
  it("records the call as kind 'tips' with the model and token usage", async () => {
    const records: LlmUsageRecord[] = [];
    const logs = await run({ tips: GOOD }, async (r) => void records.push(r));
    expect(records).toEqual([{ kind: "tips", model: "claude-haiku-4-5-20251001", usage: USAGE }]);
    expect(logs).toEqual([]);
  });

  it("records a call whose output was unusable (it was still paid for)", async () => {
    const records: LlmUsageRecord[] = [];
    await run(null, async (r) => void records.push(r));
    expect(records.map((r) => r.kind)).toEqual(["tips"]);
  });

  it("records nothing when the budget refuses the call", async () => {
    const recordUsage = vi.fn(async () => {});
    await run({ tips: GOOD }, recordUsage, false);
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("logs a recording failure and still stores the tips", async () => {
    let stored = false;
    const logs: string[] = [];
    await new TipsRefresher({ log: (m) => logs.push(m) }).refresh(WATCHES, () => ({
      db: emptyDb(() => (stored = true)),
      llm: llm({ tips: GOOD }),
      chargeBudget: async () => true,
      recordUsage: async () => {
        throw new Error("llm_usage is down");
      },
    }));
    expect(stored).toBe(true);
    expect(logs).toEqual(["1511: usage not recorded: Error: llm_usage is down"]);
  });
});
