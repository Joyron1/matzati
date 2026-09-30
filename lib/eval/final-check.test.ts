// The free part of the final paid check (scripts/eval-llm.ts --final): the query list, the plan
// printed before any call, the hard caps (retries counted) and the metrics built from live results.
// The pipeline runs here against fakes only: nothing reaches an LLM or AliExpress.
import { readFileSync } from "node:fs";
import { APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { EXPLAIN_SYSTEM, whyFromData } from "@/lib/llm/explain";
import { TITLES_SYSTEM } from "@/lib/llm/titles";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import { MAX_ALI_CALLS } from "@/lib/search/fetch-policy";
import { runSearch } from "@/lib/search/pipeline";
import { MemoryStore } from "@/lib/search/store";
import type { ResultProduct } from "@/lib/types";
import {
  ALI_RETRIES,
  CappedLlm,
  FINAL_CAPS,
  RequestCap,
  RequestCapError,
  cappedFetch,
  checkCardLines,
  emptyLedger,
  exampleQueries,
  finalQueries,
  formatPlan,
  isRetryableLlmError,
  keptProducts,
  ledgerFromResults,
  liveQueryResult,
  parseLedger,
  planFinalRun,
  searchBound,
  snapshotForQuery,
  summarizeLines,
  type FinalQuery,
  type FinalRecord,
} from "./final-check";
import type { LabelEntry } from "./labels";
import { summarize } from "./report";

// The pipeline logs a refused explain or product.query call; those are expected here.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** EVAL_QUERIES as scripts/snapshot-pools.ts reads them: eval-llm.ts starts a paid run on import. */
function evalQueriesFromScript() {
  const text = readFileSync("scripts/eval-llm.ts", "utf8");
  const block = /export const EVAL_QUERIES = \[([\s\S]*?)\] as const;/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/\{ id: "([^"]+)", topic: "[^"]+", q: "([^"]+)" \}/g)].map((m) => ({
    id: m[1],
    q: m[2],
  }));
}

const realQueries = () =>
  finalQueries(
    evalQueriesFromScript(),
    exampleQueries(readFileSync("components/search-guide.tsx", "utf8")),
  );

const q = (id: string, text: string, group: FinalQuery["group"] = "eval"): FinalQuery => ({
  id,
  group,
  q: text,
  from: "test",
});

describe("the queries", () => {
  it("reads the 9 home examples from the component's text: FULL_EXAMPLE first, then the IDEAS", () => {
    const text = readFileSync("components/search-guide.tsx", "utf8");
    const examples = exampleQueries(text);
    expect(examples.map((x) => x.id)).toEqual([
      "ex-1",
      "ex-2",
      "ex-3",
      "ex-4",
      "ex-5",
      "ex-6",
      "ex-7",
      "ex-8",
      "ex-9",
    ]);
    expect(examples[0].q).toBe(/const FULL_EXAMPLE = "([^"]+)";/.exec(text)?.[1]);
    expect(examples[0].from).toContain("FULL_EXAMPLE");
    expect(examples[8].from).toContain("IDEAS[7]");
    expect(() => exampleQueries(text.replace(/const IDEAS/, "const OTHER"))).toThrow(/8 IDEAS/);
  });

  it("puts the 20 eval queries before the examples, with unique ids", () => {
    const all = realQueries();
    expect(all).toHaveLength(29);
    expect(all.filter((x) => x.group === "eval")).toHaveLength(20);
    expect(() =>
      finalQueries(
        [{ id: "ex-1", q: "x" }],
        exampleQueries(readFileSync("components/search-guide.tsx", "utf8")),
      ),
    ).toThrow(/twice/);
  });
});

describe("planFinalRun", () => {
  it("searches each parse key once and copies the rest", () => {
    const plan = planFinalRun([
      q("a", "מתנה לאבא עד 200 ש״ח"),
      q("b", 'מתנה  לאבא עד 200 ש"ח', "example"), // the same query once normalized
      q("c", "מנורת לילה"),
    ]);
    expect(plan.toRun).toEqual(["a", "c"]);
    expect(plan.queries.map((x) => x.sameAs)).toEqual([null, "a", null]);
  });

  it("bounds a search by the pipeline's own limits", () => {
    const bound = searchBound();
    // Parse: 2 attempts, each tried twice (LLM_STAGE_LIMITS.parse.maxRetries 1); explain tried
    // twice (LLM_STAGE_LIMITS.explain.maxRetries 1, for the Hebrew titles); the titles of places
    // 6-10 tried twice too (LLM_STAGE_LIMITS.titles.maxRetries 1).
    expect(bound.llm).toEqual({ parse: 4, explain: 2, titles: 2, total: 8 });
    expect(bound.ali).toEqual({
      calls: MAX_ALI_CALLS + 1,
      tries: 1 + ALI_RETRIES,
      total: (MAX_ALI_CALLS + 1) * (1 + ALI_RETRIES),
    });
  });

  it("caps what a run may make, and counts what earlier runs today made", () => {
    const queries = Array.from({ length: 30 }, (_, i) => q(`q${i}`, `שאילתה ${i}`));
    const plan = planFinalRun(queries);
    expect(plan.llm).toEqual({
      cap: 60,
      used: 0,
      left: 60,
      uncapped: 240,
      max: 60,
      noRetries: 60,
    });
    expect(plan.ali.max).toBe(FINAL_CAPS.aliRequests);

    const resumed = planFinalRun(queries, {
      used: { llm: 10, ali: 80 },
      done: new Set(["q0", "q1", "q2", "q3", "q4"]),
    });
    expect(resumed.toRun).toHaveLength(25);
    expect(resumed.llm).toMatchObject({ used: 10, left: 50, max: 50 });
    expect(resumed.ali).toMatchObject({ used: 80, left: 7, max: 7, noRetries: 7 });
    // Nothing is left once the cap was used: the run makes no request.
    expect(planFinalRun(queries, { used: { llm: 70, ali: 0 } }).llm).toMatchObject({
      left: 0,
      max: 0,
    });
  });

  it("prints the numbers the owner sees for the real 29 queries", () => {
    // On 2026-09-28 five examples repeat an eval query word for word (gift, car holder, night
    // light, power bank, slippers): 24 searches, at most 60 LLM requests (192 without the cap, 72
    // without retries: a parse, an explain and a titles call each, since 2026-09-30) and 87
    // AliExpress requests (360 without the cap). Checked by rule, not by value, so a change of the
    // home examples does not fail this test.
    const plan = planFinalRun(realQueries());
    const copies = plan.queries.filter((x) => x.sameAs);
    for (const c of copies) {
      expect(c.group).toBe("example");
      expect(plan.queries.find((x) => x.id === c.sameAs)?.key).toBe(c.key);
    }
    expect(plan.toRun).toHaveLength(29 - copies.length);
    const n = plan.toRun.length;
    expect(plan.llm).toMatchObject({ max: Math.min(60, 8 * n), uncapped: 8 * n });
    expect(plan.ali).toMatchObject({ max: Math.min(87, 15 * n), uncapped: 15 * n });
    const text = formatPlan(plan);
    expect(text).toContain(`${n} to search now, ${copies.length} same as an earlier query`);
    expect(text).toContain(`LLM requests:        at most ${plan.llm.max} (hard cap 60`);
    expect(text).toContain(`AliExpress requests: at most ${plan.ali.max} (hard cap 87`);
    expect(text).toContain(`could ask for ${8 * n}`);
    for (const c of copies) expect(text).toContain(`${c.id} = ${c.sameAs}`);
    // Only ASCII: the plan prints ids and numbers, never the Hebrew queries.
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
  });

  it("with --only, searches what the full run would: a selected copy searches its source", () => {
    const queries = [
      q("a", "מתנה לאבא עד 200 ש״ח"),
      q("c", "מנורת לילה"),
      q("b", 'מתנה  לאבא עד 200 ש"ח', "example"),
    ];
    const copy = planFinalRun(queries, { only: new Set(["b"]) });
    expect(copy.queries.find((x) => x.id === "b")?.sameAs).toBe("a");
    expect(copy.selected).toEqual(["b"]);
    expect(copy.toRun).toEqual(["a"]);
    expect(copy.llm.uncapped).toBe(8);
    expect(formatPlan(copy)).toContain("Selected with --only: b; searched for them: a.");
    expect(planFinalRun(queries, { only: new Set(["c"]) }).toRun).toEqual(["c"]);
    // Its source recorded already: nothing to search, the copy is made from it.
    expect(planFinalRun(queries, { only: new Set(["b"]), done: new Set(["a"]) }).toRun).toEqual([]);
    expect(() => planFinalRun(queries, { only: new Set(["zz"]) })).toThrow(/unknown query id: zz/);
  });
});

describe("the ledger", () => {
  it("records every request before it is sent, and a failure to record stops it", () => {
    const seen: number[] = [];
    const cap = new RequestCap("LLM", 3, 1, (used) => seen.push(used));
    cap.take();
    cap.take();
    expect(() => cap.take()).toThrow(RequestCapError);
    expect(seen).toEqual([2, 3]);
    const broken = new RequestCap("AliExpress", 5, 0, () => {
      throw new Error("disk full");
    });
    expect(() => broken.take()).toThrow("disk full");
    expect(broken.used).toBe(1);
  });

  it("reads only a well-formed ledger, and counts results files written before it", () => {
    const ledger = { ...emptyLedger(), llmRequests: 12, aliRequests: 30 };
    expect(parseLedger(JSON.stringify(ledger))).toEqual(ledger);
    expect(() => parseLedger("{")).toThrow(/not a final-check ledger/);
    expect(() => parseLedger(JSON.stringify({ ...ledger, aliRequests: -1 }))).toThrow();
    expect(() => parseLedger(JSON.stringify({ ...ledger, kind: "final-check" }))).toThrow();
    const earlier = ledgerFromResults([
      { ledger: { llmRequests: 5, aliRequests: 9 } },
      { ledger: { llmRequests: 40, aliRequests: 70 } },
    ]);
    expect(earlier).toMatchObject({ llmRequests: 45, aliRequests: 79, runs: [] });
    // A day's file no longer holds the check's caps on its own: the sum does.
    expect(planFinalRun([q("a", "x")], { used: { llm: 45, ali: 79 } }).ali.left).toBe(8);
    expect(() => ledgerFromResults([{ ledger: {} }])).toThrow(/no readable request counts/);
  });
});

describe("RequestCap", () => {
  it("allows exactly `cap` requests and refuses the next one without counting it as made", () => {
    const cap = new RequestCap("LLM", 60);
    for (let i = 0; i < 60; i++) cap.take();
    expect(cap.left).toBe(0);
    expect(() => cap.take()).toThrow(RequestCapError);
    expect(() => cap.take()).toThrow("LLM request cap 60 reached");
    expect(cap).toMatchObject({ used: 60, refused: 2 });
    // Resumed with what earlier runs made.
    expect(new RequestCap("AliExpress", 87, 80).left).toBe(7);
  });
});

const USAGE = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A provider that plays a script: each try throws, answers unusably or answers. */
class ScriptedLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-haiku-4-5";
  sent: { kind: "parse" | "explain" | "titles"; maxRetries?: number }[] = [];
  constructor(
    private readonly script: ("timeout" | "unusable" | "ok")[] = [],
    private readonly parse: ParsedQueryRaw = PARSE,
    /** The titles call's own script (it runs beside explain, so their order is not fixed). */
    private readonly titlesScript: ("timeout" | "ok")[] = [],
  ) {}
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    const kind =
      req.system === EXPLAIN_SYSTEM ? "explain" : req.system === TITLES_SYSTEM ? "titles" : "parse";
    this.sent.push({ kind, maxRetries: req.maxRetries });
    const step = (kind === "titles" ? this.titlesScript.shift() : this.script.shift()) ?? "ok";
    if (step === "timeout") throw new APIConnectionTimeoutError();
    if (step === "unusable") return { data: null, usage: USAGE, model: this.model };
    if (kind === "titles") {
      const { products } = JSON.parse(req.user) as { products: { id: string }[] };
      const items = products.map((p) => ({ id: p.id, title_he: "כבל USB לטעינה" }));
      return { data: { items } as z.infer<T>, usage: USAGE, model: this.model };
    }
    if (kind === "explain") {
      const { products } = JSON.parse(req.user) as { products: { id: string }[] };
      const items = products.map((p, i) => ({
        id: p.id,
        title_he: "כבל טעינה מהיר",
        why_he: WHYS[i % WHYS.length],
      }));
      return { data: { items } as z.infer<T>, usage: USAGE, model: this.model };
    }
    return { data: this.parse as z.infer<T>, usage: USAGE, model: this.model };
  }
}

const PARSE: ParsedQueryRaw = {
  product_he: "כבל USB",
  product_terms: ["cable"],
  requirements: [],
  keywords_en: "usb cable",
  min_price_ils: null,
  max_price_ils: 40,
  sort_preference: "best_value",
  category_hint: null,
};
const WHYS = [
  "עבר את הסינון עם משוב חיובי גבוה ומכירות רבות בחודש האחרון.",
  "מתאים לחיפוש ונמכר הרבה בחודש האחרון, עם משוב חיובי גבוה.",
  "בחירה פופולרית שעברה את הסינון, עם משוב חיובי גבוה.",
];
const req = (maxRetries?: number): StructuredRequest<z.ZodType> => ({
  system: "parse",
  user: "x",
  schema: {} as z.ZodType,
  maxTokens: 10,
  maxRetries,
});
const noWait = { sleep: async () => {} };

describe("CappedLlm", () => {
  it("counts every try against the cap and sends each with maxRetries 0", async () => {
    const inner = new ScriptedLlm(["timeout", "ok"]);
    const cap = new RequestCap("LLM", 60);
    const llm = new CappedLlm(inner, cap, noWait);
    await expect(llm.generateStructured(req(1))).resolves.toMatchObject({ usage: USAGE });
    expect(cap.used).toBe(2);
    expect(inner.sent.map((s) => s.maxRetries)).toEqual([0, 0]);
  });

  it("retries only what the request allows, and only errors the SDK would retry", async () => {
    const cap = new RequestCap("LLM", 60);
    await expect(
      new CappedLlm(new ScriptedLlm(["timeout", "ok"]), cap, noWait).generateStructured(req(0)),
    ).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    expect(cap.used).toBe(1);
    const failing: LlmProvider = {
      name: "anthropic",
      model: "m",
      generateStructured: async () => {
        throw APIError.generate(
          400,
          { error: { type: "invalid_request_error" } },
          "bad",
          new Headers(),
        );
      },
    };
    await expect(new CappedLlm(failing, cap, noWait).generateStructured(req(3))).rejects.toThrow();
    expect(cap.used).toBe(2);
  });

  it("sends nothing past the cap: the request after the last one throws RequestCapError", async () => {
    const inner = new ScriptedLlm(["timeout", "timeout", "timeout"]);
    const cap = new RequestCap("LLM", 2);
    const llm = new CappedLlm(inner, cap, noWait);
    await expect(llm.generateStructured(req(5))).rejects.toBeInstanceOf(RequestCapError);
    expect(inner.sent).toHaveLength(2);
    expect(cap).toMatchObject({ used: 2, refused: 1 });
  });

  it("classifies errors like the SDK's retry rule", () => {
    const status = (s: number) => APIError.generate(s, undefined, "x", new Headers());
    for (const s of [408, 409, 429, 500, 529]) expect(isRetryableLlmError(status(s))).toBe(true);
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryableLlmError(status(s))).toBe(false);
    expect(isRetryableLlmError(new APIConnectionTimeoutError())).toBe(true);
    expect(isRetryableLlmError(new APIUserAbortError())).toBe(false);
    expect(isRetryableLlmError(new Error("x"))).toBe(false);
    expect(isRetryableLlmError(new RequestCapError("LLM", 1))).toBe(false);
  });
});

// Real product.query response ("usb cable", ILS), captured by check:ali.
const PRODUCTS = readFileSync(
  "fixtures/aliexpress/aliexpress.affiliate.product.query.json",
  "utf8",
);

/** runSearch as the final check runs it: capped provider, capped fetch, in-memory store. */
function cappedSearch(
  script: ConstructorParameters<typeof ScriptedLlm>[0],
  caps = FINAL_CAPS,
  titlesScript: ConstructorParameters<typeof ScriptedLlm>[2] = [],
) {
  const llmCap = new RequestCap("LLM", caps.llmRequests);
  const aliCap = new RequestCap("AliExpress", caps.aliRequests);
  const inner = new ScriptedLlm(script, PARSE, titlesScript);
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCTS));
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: cappedFetch(aliCap, fetchMock), sleep: async () => {}, retries: ALI_RETRIES },
  );
  const deps = {
    llm: new CappedLlm(inner, llmCap, noWait),
    ali,
    store: new MemoryStore(),
    sleep: async () => {},
  };
  return { deps, inner, llmCap, aliCap, fetchMock };
}

describe("a search under the caps (the real pipeline, faked services)", () => {
  it("reaches the per-search bound and never goes past it", async () => {
    // Parse: a timeout, then an unusable answer; the retry attempt: a timeout, then a parse.
    // Explain: a timeout, then the lines. Titles (places 6-10): a timeout, then the titles.
    const t = cappedSearch(["timeout", "unusable", "timeout", "ok", "timeout", "ok"], FINAL_CAPS, [
      "timeout",
      "ok",
    ]);
    const { response, meta } = await runSearch({ q: "כבל USB עד 40 ש״ח" }, t.deps);
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.extra_results?.every((r) => r.title_he === "כבל USB לטעינה")).toBe(true);
    const kinds = t.inner.sent.map((s) => s.kind);
    expect(kinds.slice(0, 4)).toEqual(["parse", "parse", "parse", "parse"]);
    // Explain and titles run side by side: their tries interleave.
    expect(kinds.slice(4).sort()).toEqual(["explain", "explain", "titles", "titles"]);
    expect(t.llmCap.used).toBe(searchBound().llm.total);
    expect(t.aliCap.used).toBe(t.fetchMock.mock.calls.length);
    expect(t.aliCap.used).toBe(meta.aliCalls + meta.linkCalls);
    expect(t.aliCap.used).toBeLessThanOrEqual(searchBound().ali.total);
  });

  it("marks a search that met the LLM cap: explain and titles are refused, never sent", async () => {
    const t = cappedSearch(["ok"], { llmRequests: 1, aliRequests: 87 });
    const { meta } = await runSearch({ q: "כבל USB עד 40 ש״ח" }, t.deps);
    // The pipeline shows lines from the data and AliExpress's titles when these calls fail; the
    // eval sees the refusals.
    expect(meta.explainFailed).toBe(true);
    expect(meta.titlesFailed).toBe(true);
    expect(t.inner.sent.map((s) => s.kind)).toEqual(["parse"]);
    expect(t.llmCap).toMatchObject({ used: 1, refused: 2 });
  });

  it("sends no AliExpress request past the cap (retries included)", async () => {
    const t = cappedSearch(["ok"], { llmRequests: 60, aliRequests: 0 });
    await expect(runSearch({ q: "כבל USB עד 40 ש״ח" }, t.deps)).rejects.toMatchObject({
      code: "upstream",
    });
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.aliCap.refused).toBe(1 + ALI_RETRIES);
  });
});

// ---------------------------------------------------------------- metrics

function result(over: Partial<ResultProduct> & { product_id: string }): ResultProduct {
  return {
    title_he: "כבל טעינה מהיר USB-C",
    title_en: "USB-C Fast Charging Cable 1m",
    why_he: WHYS[0],
    price_ils: 20,
    original_price_ils: null,
    price_is_approx: false,
    discount_pct: null,
    positive_feedback_pct: 97.5,
    units_sold: 1200,
    passed_tier: "standard",
    image_urls: [],
    category_id: "44",
    ...over,
  };
}

async function finishedRecord(): Promise<FinalRecord> {
  const t = cappedSearch(["ok"]);
  const { response, meta } = await runSearch({ q: "כבל USB עד 40 ש״ח" }, t.deps);
  const cached = await t.deps.store.getResults(response.filters_key!, new Date());
  return {
    id: "cable",
    group: "eval",
    query: "כבל USB עד 40 ש״ח",
    from: "test",
    parsed: cached!.filters,
    meta,
    response,
    kept: keptProducts(cached!.products),
  };
}

describe("liveQueryResult (the offline report's metrics from a live search)", () => {
  it("reads the shown cards, the next page and the labels of the same query", async () => {
    const rec = await finishedRecord();
    const [lead, second] = rec.response!.results;
    const labels = new Map<string, LabelEntry>([
      [lead.product_id, { productId: lead.product_id, label: "exact", note: "" }],
      [second.product_id, { productId: second.product_id, label: "wrong", note: "" }],
    ]);
    const r = liveQueryResult(rec, labels);
    expect(r.error).toBeNull();
    expect(r.top3.map((l) => l.id)).toEqual(rec.response!.results.map((x) => x.product_id));
    expect(r.passed).toBe(rec.response!.passed_count);
    expect(r.next3.every((l) => !r.top3.some((t) => t.id === l.id))).toBe(true);
    expect(r.labels).toMatchObject({ leadCorrect: true, wrongTop3: 1, cardsLabelled: 2 });
    expect(r.sameShopTop3).toBeGreaterThanOrEqual(1);

    const summary = summarize([
      r,
      liveQueryResult({ ...rec, id: "copy", sameAs: "cable" }, labels),
    ]);
    expect(summary).toMatchObject({ queries: 2, copies: 1 });
    expect(summary.labels).toMatchObject({ leadCorrect: 2, wrongTop3: 2 });
  });

  it("counts a capped or failed search as an error, never as results", async () => {
    const rec = await finishedRecord();
    expect(liveQueryResult({ ...rec, capped: "llm" }, null).error).toBe("capped (llm)");
    const failed = liveQueryResult({ ...rec, response: undefined, error: "llm: parse" }, null);
    expect(failed).toMatchObject({ error: "llm: parse", shown: 0 });
    expect(summarize([failed]).errors).toEqual(["cable"]);
  });

  it("finds the snapshot of the same query text, whatever its id", () => {
    const snaps = [
      { id: "ex-1", query: "אוזניות לריצה, עמידות למים, עד 100 ש״ח", sameQueryAs: "pair-a" },
      { id: "pair-a", query: "אוזניות לריצה, עמידות למים, עד 100 ש״ח", sameQueryAs: null },
      { id: "ex-7", query: "שעון חכם עם מד דופק עד 150 ש״ח", sameQueryAs: null },
    ];
    expect(snapshotForQuery(snaps, 'אוזניות לריצה, עמידות למים, עד 100 ש"ח')?.id).toBe("pair-a");
    expect(snapshotForQuery(snaps, "שעון חכם עם מד דופק עד 150 ש״ח")?.id).toBe("ex-7");
    expect(snapshotForQuery(snaps, "משהו אחר")).toBeNull();
  });
});

describe("Hebrew line checks", () => {
  it("passes clean lines and marks lines built from the data", () => {
    const base = result({ product_id: "2" });
    const data = {
      ...base,
      why_he: whyFromData({
        product_id: base.product_id,
        title_en: base.title_en,
        price_ils: base.price_ils,
        original_price_ils: base.original_price_ils,
        discount_pct: base.discount_pct,
        positive_feedback_pct: base.positive_feedback_pct,
        units_sold_30d: base.units_sold,
      }),
    };
    const [clean, fromData] = checkCardLines([result({ product_id: "1" }), data], {
      hasBudget: true,
    });
    expect(clean.problems).toEqual([]);
    expect(fromData.problems).toEqual(["data_line"]);
    // A rejected line, or a failed explain call, is a line from the data.
    const one = [result({ product_id: "1" })];
    expect(checkCardLines(one, { hasBudget: true, explainFailed: true })[0].problems).toEqual([
      "data_line",
    ]);
    expect(
      checkCardLines(one, { hasBudget: true, rejectedIds: new Set(["1"]) })[0].problems,
    ).toEqual(["data_line"]);
  });

  it("finds the site's style problems and a budget nobody gave", () => {
    const [quote, bang, english, budget, repeat] = checkCardLines(
      [
        result({ product_id: "1", why_he: 'כבל באורך 30 ס"מ, עם משוב חיובי גבוה בחודש האחרון.' }),
        result({ product_id: "2", title_he: "כבל טעינה מעולה!", why_he: WHYS[1] }),
        result({ product_id: "3", title_he: "USB-C Fast Charging Cable 1m", why_he: WHYS[2] }),
        result({ product_id: "4", why_he: "כבל שמתאים לתקציב שלכם, עם משוב חיובי גבוה מאוד." }),
        result({ product_id: "5", why_he: WHYS[1] }),
      ],
      { hasBudget: false },
    );
    expect(quote.problems).toEqual(["ascii_quote"]);
    expect(bang.problems).toEqual(["exclamation"]);
    expect(english.problems).toEqual(["english_title"]);
    expect(budget.problems).toEqual(["unstated_budget"]);
    expect(repeat.problems).toEqual(["repeated_line"]);
  });

  it("summarizes the distinct searches' cards against the 10% gate", async () => {
    const rec = await finishedRecord();
    const summary = summarizeLines([rec, { ...rec, id: "copy", sameAs: "cable" }]);
    expect(summary.queries).toBe(1);
    expect(summary.cards).toBe(rec.response!.results.length);
    expect(summary.defectRate).toBe(summary.cardsWithDefect / summary.cards);
  });
});
