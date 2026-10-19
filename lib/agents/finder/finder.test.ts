import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { LlmProvider, LlmUsage, StructuredRequest } from "@/lib/llm/provider";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "../settings";
import { runFinder, worstCaseCostUsd, type FinderStore, type NewCandidate } from "./run";
import {
  commissionOf,
  isCandidate,
  MAX_CANDIDATES_PER_RUN,
  SCAN_CALLS_PER_RUN,
  scanTargets,
  selectCandidates,
  targetsForRun,
} from "./select";
import { postFromData, textHolds, writePosts, writerInput } from "./write";

const product = (id: string, over: Partial<AliProduct> = {}): AliProduct =>
  ({
    productId: id,
    title: "מכונית שלט רחוק 1:24 לילדים",
    price: 81.39,
    originalPrice: 166.1,
    currency: "ILS",
    discountPct: 51,
    positiveFeedbackPct: 96.5,
    unitsSold: 993,
    mainImageUrl: "https://ae01.alicdn.com/kf/a.jpg",
    imageUrls: ["https://ae01.alicdn.com/kf/a.jpg"],
    detailUrl: "",
    promotionLink: "https://s.click.aliexpress.com/e/_x",
    shop: { id: `shop-${id}`, name: null, url: null },
    commissionRatePct: 7,
    hotCommissionRatePct: 25,
    category: { firstId: "26", firstName: null, secondId: "100", secondName: null },
    ...over,
  }) as AliProduct;

describe("finder selection", () => {
  it("covers every catalog list, pages 1-3, and rotates through them run by run", () => {
    const targets = scanTargets();
    expect(new Set(targets.map((t) => t.pageNo))).toEqual(new Set([1, 2, 3]));
    const run0 = targetsForRun(targets, 0);
    const run1 = targetsForRun(targets, 1);
    expect(run0).toHaveLength(SCAN_CALLS_PER_RUN);
    expect(run0).not.toEqual(run1);
    // A full cycle visits every target.
    const runs = Math.ceil(targets.length / SCAN_CALLS_PER_RUN);
    const seen = new Set(
      Array.from({ length: runs }, (_, i) => targetsForRun(targets, i))
        .flat()
        .map((t) => `${t.categoryId}:${t.pageNo}`),
    );
    expect(seen.size).toBe(targets.length);
  });

  it("takes the hot rate when it is higher", () => {
    expect(commissionOf({ commissionRatePct: 7, hotCommissionRatePct: 25 })).toBe(25);
    expect(commissionOf({ commissionRatePct: 22, hotCommissionRatePct: null })).toBe(22);
    expect(commissionOf({ commissionRatePct: null, hotCommissionRatePct: undefined })).toBeNull();
  });

  it("asks 20% and the site's trust bar, an ILS price, a link and a photo", () => {
    expect(isCandidate(product("1"))).toBe(true);
    expect(isCandidate(product("1", { hotCommissionRatePct: 19.9 }))).toBe(false);
    expect(isCandidate(product("1", { unitsSold: 99 }))).toBe(false);
    expect(isCandidate(product("1", { positiveFeedbackPct: 89 }))).toBe(false);
    expect(isCandidate(product("1", { currency: "USD" }))).toBe(false);
    expect(isCandidate(product("1", { promotionLink: null }))).toBe(false);
    expect(isCandidate(product("1", { imageUrls: [] }))).toBe(false);
    expect(
      isCandidate(
        product("1", {
          category: { firstId: "66", firstName: null, secondId: "200001508", secondName: null },
        }),
      ),
    ).toBe(false);
  });

  it("never proposes a product twice, one per shop, the best-selling first", () => {
    const chosen = selectCandidates(
      [
        product("a", { unitsSold: 200 }),
        product("b", { unitsSold: 5000 }),
        product("c", { unitsSold: 900, shop: { id: "shop-b", name: null, url: null } }),
        product("d", { unitsSold: 3000 }),
        product("b", { unitsSold: 5000 }),
      ],
      new Set(["d"]),
    );
    expect(chosen.map((p) => p.productId)).toEqual(["b", "a"]);
    const many = Array.from({ length: 30 }, (_, i) => product(String(i)));
    expect(selectCandidates(many, new Set())).toHaveLength(MAX_CANDIDATES_PER_RUN);
  });
});

describe("finder writer", () => {
  const input = writerInput(product("1"));

  it("builds a post from the data alone, every number grounded", () => {
    const post = postFromData(input);
    expect(post).toContain("₪81.39 במקום ₪166.10".replace("166.10", "166.10"));
    expect(textHolds(post, input, 10, 600)).toBe(true);
  });

  it("refuses a text with a number not in the data, a link, or no Hebrew", () => {
    expect(textHolds("מכונית שלט רחוק במחיר ₪49 בלבד, שווה לבדוק!", input, 10, 600)).toBe(false);
    expect(textHolds("מכונית שלט רחוק, ראו https://x.test", input, 10, 600)).toBe(false);
    expect(textHolds("A remote control car for kids, worth it", input, 10, 600)).toBe(false);
    expect(textHolds("מכונית שלט רחוק עם עמלה גבוהה לנו", input, 10, 600)).toBe(false);
  });

  class Llm implements LlmProvider {
    readonly name = "anthropic" as const;
    readonly model = "claude-haiku-5-5";
    calls = 0;
    constructor(private readonly items: { id: string; post_he: string; why_he: string }[]) {}
    async generateStructured<T extends z.ZodType>(_req: StructuredRequest<T>) {
      this.calls++;
      const usage: LlmUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      return { data: { items: this.items } as z.infer<T>, usage, model: this.model };
    }
  }

  it("keeps a model post that holds and falls back for one that does not", async () => {
    const good =
      "מכונית שלט רחוק קטנה לילדים 🚗\nבקנה מידה 1:24\n💰 ₪81.39 במקום ₪166.1\n⭐ 96.5% משוב חיובי, 993 נמכרו ב־30 הימים האחרונים";
    const llm = new Llm([
      { id: "1", post_he: good, why_he: "993 מכירות בחודש ו־96.5% משוב." },
      { id: "2", post_he: "מכונית ב־₪10 בלבד! הכי זולה שיש", why_he: "זולה" },
    ]);
    const out = await writePosts(llm, [product("1"), product("2")]);
    expect(out.posts.get("1")).toMatchObject({ post_he: good, fallback: false });
    expect(out.posts.get("2")?.fallback).toBe(true);
    expect(out.usage?.outputTokens).toBe(500);
  });

  it("makes no call without a model, and survives a failed one", async () => {
    expect((await writePosts(null, [product("1")])).posts.get("1")?.fallback).toBe(true);
    const failing: LlmProvider = {
      name: "anthropic",
      model: "x",
      generateStructured: () => Promise.reject(new Error("timeout")),
    };
    const out = await writePosts(failing, [product("1")]);
    expect(out.posts.get("1")?.fallback).toBe(true);
    expect(out.usage).toBeNull();
  });
});

// --- A whole run, with AliExpress and the database faked ----------------------------------------

const HOT = JSON.parse(
  readFileSync(
    "fixtures/aliexpress/probe-hot/aliexpress.affiliate.hotproduct.query.cat44-HE.json",
    "utf8",
  ),
) as Record<string, unknown>;
const LINKS = readFileSync(
  "fixtures/aliexpress/probe-hot/aliexpress.affiliate.link.generate.type2.json",
  "utf8",
);

/** The fixture's hot list with its first `n` products paying a 25% hot rate. */
function hotList(n: number): string {
  const text = JSON.stringify(HOT);
  let i = 0;
  return text.replace(/"hot_product_commission_rate":"[^"]*"/g, (m) =>
    i++ < n ? '"hot_product_commission_rate":"25.0%"' : m,
  );
}

class FakeStore implements FinderStore {
  runs = 0;
  spent = 0;
  known = new Set<string>();
  added: NewCandidate[] = [];
  saved: AliProduct[] = [];
  usage: string[] = [];
  finished: Parameters<FinderStore["finishRun"]>[1][] = [];
  async runCount() {
    return this.runs;
  }
  async spentTodayUsd() {
    return this.spent;
  }
  async knownProductIds(ids: string[]) {
    return new Set(ids.filter((id) => this.known.has(id)));
  }
  async startRun() {
    this.runs++;
    return "run-1";
  }
  async finishRun(_id: string, r: Parameters<FinderStore["finishRun"]>[1]) {
    this.finished.push(r);
  }
  async insertCandidates(_run: string, c: NewCandidate[]) {
    this.added.push(...c);
    return c.length;
  }
  async saveProducts(p: AliProduct[]) {
    this.saved.push(...p);
  }
  async logUsage(model: string) {
    this.usage.push(model);
  }
}

function setup(hotPaying = 12) {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const method = new URLSearchParams(String(init?.body)).get("method");
    return new Response(
      method === "aliexpress.affiliate.link.generate" ? LINKS : hotList(hotPaying),
    );
  });
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: async () => {} },
  );
  const store = new FakeStore();
  const llmCalls: string[] = [];
  const llm: LlmProvider = {
    name: "anthropic",
    model: "claude-haiku-5-5",
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
      llmCalls.push(req.system.slice(0, 10));
      const usage: LlmUsage = {
        inputTokens: 3000,
        outputTokens: 1500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      return { data: { items: [] } as z.infer<T>, usage, model: "claude-haiku-5-5" };
    },
  };
  return { fetchMock, store, llm, llmCalls, deps: { ali, llm, store, sleep: async () => {} } };
}

const ON: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, finderEnabled: true };

describe("runFinder", () => {
  it("does nothing on the schedule while the finder is off", async () => {
    const { deps, fetchMock, store } = setup();
    const r = await runFinder("cron", DEFAULT_AGENT_SETTINGS, deps);
    expect(r.status).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.runs).toBe(0);
  });

  it("scans its lists, queues the candidates with posts and logs the run", async () => {
    const { deps, store, llmCalls, fetchMock } = setup();
    const r = await runFinder("admin", DEFAULT_AGENT_SETTINGS, deps);
    expect(r.status).toBe("ok");
    expect(r.aliCalls).toBeLessThanOrEqual(SCAN_CALLS_PER_RUN + 1);
    expect(fetchMock.mock.calls.length).toBe(r.aliCalls);
    expect(r.added).toBeGreaterThan(0);
    expect(r.added).toBeLessThanOrEqual(MAX_CANDIDATES_PER_RUN);
    expect(store.added.every((c) => c.commissionPct >= 20 && c.postHe.length > 0)).toBe(true);
    // Saved as hot rows before they are queued, so /p and /go work for them.
    expect(store.saved.map((p) => p.productId)).toEqual(store.added.map((c) => c.productId));
    expect(store.saved.every((p) => p.source === "hot")).toBe(true);
    expect(llmCalls).toHaveLength(1);
    expect(store.usage).toEqual(["claude-haiku-5-5"]);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(store.finished).toHaveLength(1);
  });

  it("writes posts from the data once the day's budget is spent", async () => {
    const { deps, store, llmCalls } = setup();
    store.spent = 1;
    const r = await runFinder("cron", ON, deps);
    expect(llmCalls).toHaveLength(0);
    expect(r.costUsd).toBe(0);
    expect(r.note).toMatch(/budget/);
    expect(r.added).toBeGreaterThan(0);
  });

  it("queues nothing new when nothing pays 20%", async () => {
    const { deps, store } = setup(0);
    const r = await runFinder("admin", ON, deps);
    expect(r.added).toBe(0);
    expect(store.added).toHaveLength(0);
    expect(r.note).toMatch(/20%/);
  });

  it("bounds a writer call's cost by the model", () => {
    expect(worstCaseCostUsd("claude-haiku-5-5", 10)).toBeLessThan(0.01);
    expect(worstCaseCostUsd("claude-opus-5-5", 10)).toBeGreaterThan(0.1);
    expect(worstCaseCostUsd("unknown-model", 10)).toBe(Number.POSITIVE_INFINITY);
  });
});
