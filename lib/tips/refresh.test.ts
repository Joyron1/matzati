import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import { TIPS_VERSION } from "@/lib/llm/tips";
import type { TipsCategory } from "./category";
import { TipsRefresher, type TipsJobDeps } from "./refresh";
import { TIPS_MAX_AGE_MS } from "./store";

// lib/supabase/server is server-only; the tests pass their own client.
vi.mock("server-only", () => ({}));

type Row = { category_id: string; tips_he: unknown; updated_at: string };

/** category_tips in memory: select().eq().maybeSingle() and upsert(). */
class FakeDb {
  rows = new Map<string, Row>();
  writes = 0;

  client() {
    const from = () => {
      let key = "";
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          key = value;
          return query;
        },
        maybeSingle: async () => ({ data: this.rows.get(key) ?? null, error: null }),
        upsert: async (row: Row) => {
          this.writes++;
          this.rows.set(row.category_id, row);
          return { data: null, error: null };
        },
      };
      return query;
    };
    return { from } as unknown as SupabaseClient;
  }
}

const USAGE: LlmUsage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
const GOOD = [
  "בדקו שהחיבור לטעינה הוא USB-C, כדי שתוכלו להשתמש באותו כבל של הטלפון.",
  "חפשו עמידות למים לפי תקן מוגדר כמו IPX7, ולא רק את המילה עמיד.",
  "קראו מה כלול באריזה לפני ההזמנה, כי חלק מהאביזרים נמכרים בנפרד.",
];

/** An LLM whose answers are released by the test, so concurrent views overlap for real. */
function fakeLlm(answer: () => unknown = () => ({ tips: GOOD })) {
  const calls: string[] = [];
  const pending: (() => void)[] = [];
  const llm: LlmProvider = {
    name: "anthropic",
    model: "fake",
    generateStructured(req) {
      calls.push(req.user);
      return new Promise((resolve, reject) => {
        pending.push(() => {
          try {
            const data = answer();
            resolve({
              data: data === null ? null : req.schema.parse(data),
              usage: USAGE,
              model: "fake",
            });
          } catch (err) {
            reject(err);
          }
        });
      });
    },
  };
  const releaseAll = async () => {
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    pending.splice(0).forEach((release) => release());
  };
  return { llm, calls, releaseAll };
}

const EARPHONES: TipsCategory = {
  id: "100000306",
  nameEn: "Portable Audio & Video",
  parentEn: "Consumer Electronics",
};
const WATCHES: TipsCategory = { id: "1511", nameEn: "Watches", parentEn: null };

function setup(answer?: () => unknown, budget = () => true) {
  const db = new FakeDb();
  const { llm, calls, releaseAll } = fakeLlm(answer);
  const charges: number[] = [];
  let clock = Date.parse("2026-09-27T10:00:00Z");
  const logs: string[] = [];
  const refresher = new TipsRefresher({
    clock: () => clock,
    log: (m) => logs.push(m),
    retryAfterMs: 60_000,
  });
  const deps = (): TipsJobDeps => ({
    db: db.client(),
    llm,
    chargeBudget: async () => {
      charges.push(clock);
      return budget();
    },
  });
  return {
    db,
    calls,
    charges,
    logs,
    releaseAll,
    refresh: (c: TipsCategory) => refresher.refresh(c, deps),
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

describe("TipsRefresher", () => {
  it("makes one LLM call per category for concurrent views", async () => {
    const t = setup();
    const runs = [
      t.refresh(EARPHONES),
      t.refresh(EARPHONES),
      t.refresh(WATCHES),
      t.refresh(EARPHONES),
    ];
    await vi.waitFor(() => expect(t.calls).toHaveLength(2));
    await t.releaseAll();
    await Promise.all(runs);

    expect(t.calls.map((u) => JSON.parse(u))).toEqual([
      { category: "Portable Audio & Video", parent_category: "Consumer Electronics" },
      { category: "Watches" },
    ]);
    expect(t.charges).toHaveLength(2);
    expect(t.db.writes).toBe(2);
    expect(t.db.rows.get(EARPHONES.id)).toEqual({
      category_id: EARPHONES.id,
      tips_he: { v: TIPS_VERSION, category_en: "Portable Audio & Video", tips: GOOD },
      updated_at: new Date(t.now()).toISOString(),
    });

    // A fresh entry is found by the re-read: no second call.
    await t.refresh(EARPHONES);
    expect(t.calls).toHaveLength(2);
  });

  it("regenerates an entry once it is stale", async () => {
    const t = setup();
    const first = t.refresh(WATCHES);
    await t.releaseAll();
    await first;
    t.advance(TIPS_MAX_AGE_MS);
    const second = t.refresh(WATCHES);
    await t.releaseAll();
    await second;
    expect(t.calls).toHaveLength(2);
  });

  it("does not call the model when the daily budget is used up, and backs off", async () => {
    const t = setup(undefined, () => false);
    await t.refresh(WATCHES);
    expect(t.calls).toHaveLength(0);
    expect(t.db.writes).toBe(0);
    expect(t.logs).toEqual(["1511: daily LLM budget is used up"]);

    await t.refresh(WATCHES); // within the retry window: nothing at all
    expect(t.charges).toHaveLength(1);
    t.advance(60_000);
    await t.refresh(WATCHES);
    expect(t.charges).toHaveLength(2);
  });

  it("stores an empty entry when too few tips pass, so it is not paid for again", async () => {
    const t = setup(() => ({ tips: [GOOD[0], "אחריות של 3 שנים היא סימן טוב."] }));
    const run = t.refresh(WATCHES);
    await t.releaseAll();
    await run;
    expect(t.db.rows.get(WATCHES.id)?.tips_he).toEqual({
      v: TIPS_VERSION,
      category_en: "Watches",
      tips: [],
    });
    expect(t.logs).toEqual(["1511: too few tips passed the checks (number)"]);
    await t.refresh(WATCHES);
    expect(t.calls).toHaveLength(1);
  });

  it("logs errors, never rejects, and retries after the backoff", async () => {
    let fail = true;
    const t = setup(() => {
      if (fail) throw new Error("overloaded");
      return { tips: GOOD };
    });
    const run = t.refresh(WATCHES);
    await t.releaseAll();
    await expect(run).resolves.toBeUndefined();
    expect(t.logs).toEqual(["1511: Error: overloaded"]);
    expect(t.db.writes).toBe(0);

    await t.refresh(WATCHES);
    expect(t.calls).toHaveLength(1);

    fail = false;
    t.advance(60_000);
    const retry = t.refresh(WATCHES);
    await t.releaseAll();
    await retry;
    expect(t.calls).toHaveLength(2);
    expect(t.db.writes).toBe(1);
  });

  it("logs a config error from the deps (for example a missing API key)", async () => {
    const logs: string[] = [];
    const refresher = new TipsRefresher({ log: (m) => logs.push(m) });
    await refresher.refresh(WATCHES, () => {
      throw new Error("Missing or invalid environment variables: API_KEY");
    });
    expect(logs).toEqual(["1511: Error: Missing or invalid environment variables: API_KEY"]);
  });
});
