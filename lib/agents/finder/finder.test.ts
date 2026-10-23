import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { LlmProvider, LlmUsage, StructuredRequest } from "@/lib/llm/provider";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "../settings";
import {
  runFinder,
  worstCaseCostUsd,
  type FinderStore,
  type NewCandidate,
  SHIPPING_MAX_CHECKS,
} from "./run";
import {
  commissionOf,
  HOT_BONUS_PCT,
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

  it("asks the standard rate (7%), the site's trust bar, an ILS price, a link and a photo", () => {
    expect(isCandidate(product("1"))).toBe(true);
    // The hot rate alone never qualifies a product (2026-10-23: unconfirmed).
    expect(isCandidate(product("1", { commissionRatePct: 3, hotCommissionRatePct: 20 }))).toBe(
      false,
    );
    expect(isCandidate(product("1", { commissionRatePct: 6.9 }))).toBe(false);
    expect(HOT_BONUS_PCT).toBe(20);
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

  it("never proposes a product twice, one per shop, the highest standard rate first", () => {
    const chosen = selectCandidates(
      [
        product("a", { unitsSold: 200, commissionRatePct: 9 }),
        product("b", { unitsSold: 5000 }),
        product("c", { unitsSold: 900, shop: { id: "shop-b", name: null, url: null } }),
        product("d", { unitsSold: 3000, commissionRatePct: 12 }),
        product("b", { unitsSold: 5000 }),
        product("e", { unitsSold: 100 }),
      ],
      new Set(["d"]),
    );
    expect(chosen.map((p) => p.productId)).toEqual(["a", "b", "e"]);
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
    const good = [
      "🔥 מכונית שלט רחוק קטנה שהילדים לא יעזבו",
      "✅ קנה מידה 1:24: קטנה, קלה ונוחה לנסיעה בבית",
      "✅ שלט רחוק: הילדים שולטים במכונית מכל פינה בחדר",
      "💰 ₪81.39 במקום ₪166.1 (51% הנחה)",
      "⭐ 96.5% משוב חיובי · 993 נמכרו ב־30 הימים האחרונים",
      "👇 לחצו על ״לקנייה באלי אקספרס״ כאן למטה ובדקו את המחיר עכשיו",
    ].join("\n");
    const llm = new Llm([
      { id: "1", post_he: good, why_he: "993 מכירות בחודש ו־96.5% משוב." },
      { id: "2", post_he: "מכונית ב־₪10 בלבד! הכי זולה שיש", why_he: "זולה" },
    ]);
    const out = await writePosts(llm, [product("1"), product("2")]);
    expect(out.posts.get("1")).toMatchObject({ post_he: good, fallback: false });
    expect(out.posts.get("2")?.fallback).toBe(true);
    expect(out.usage?.outputTokens).toBe(500);
  });

  it("adds the coupons it is given, every number of them grounded", () => {
    const coupon = { code: "MATZATI5", offer: "₪5 הנחה", min_order_ils: 40, ends: "31.10" };
    const withCoupon = writerInput(product("1"), [coupon]);
    const post = postFromData(withCoupon);
    expect(post).toContain("🎟️ קוד קופון: MATZATI5");
    expect(post).toContain("בהזמנה מעל ₪40");
    expect(textHolds(post, withCoupon, 10, 900)).toBe(true);
    // Without the coupon in the data, its numbers are not grounded.
    expect(textHolds(post, input, 10, 900)).toBe(false);
  });

  it("writes in parallel batches and sums their usage", async () => {
    const llm = new Llm([]);
    const out = await writePosts(
      llm,
      Array.from({ length: 7 }, (_, i) => product(String(i))),
    );
    expect(llm.calls).toBe(3); // batches of 3, 3 and 1
    expect(out.usage?.outputTokens).toBe(1500);
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

/** The fixture's hot list with its first `n` products paying a standard 9% (and a hot 25%). */
function hotList(n: number): string {
  const text = JSON.stringify(HOT);
  let i = 0;
  let j = 0;
  return text
    .replace(/"hot_product_commission_rate":"[^"]*"/g, (m) =>
      i++ < n ? '"hot_product_commission_rate":"25.0%"' : m,
    )
    .replace(/"commission_rate":"[^"]*"/g, () =>
      j++ < n ? '"commission_rate":"9.0%"' : '"commission_rate":"3.0%"',
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
  stages: number[] = [];
  async progress(_id: string, percent: number) {
    this.stages.push(percent);
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

/** product.shipping.get's envelope: free for product ids ending in an even digit. */
function shippingFor(productId: string | null): string {
  const free = Number((productId ?? "1").slice(-1)) % 2 === 0;
  return JSON.stringify({
    aliexpress_affiliate_product_shipping_get_response: {
      resp_result: {
        resp_code: 200,
        resp_msg: "Call succeeds",
        result: {
          shipping_fee: free ? "0.00" : "7.49",
          min_delivery_days: "7",
          max_delivery_days: "12",
          ship_from_country: "CN",
        },
      },
    },
  });
}

function setup(hotPaying = 12) {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const body = new URLSearchParams(String(init?.body));
    const method = body.get("method");
    if (method === "aliexpress.affiliate.product.shipping.get") {
      return new Response(shippingFor(body.get("product_id")));
    }
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

// The free-shipping check has its own test below.
const ANY_SHIPPING: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, freeShippingOnly: false };
const ON: AgentSettings = { ...ANY_SHIPPING, finderEnabled: true };

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
    const r = await runFinder("admin", ANY_SHIPPING, deps);
    expect(r.status).toBe("ok");
    expect(r.aliCalls).toBeLessThanOrEqual(SCAN_CALLS_PER_RUN + 2); // + hot links + details
    expect(fetchMock.mock.calls.length).toBe(r.aliCalls);
    expect(r.added).toBeGreaterThan(0);
    expect(r.added).toBeLessThanOrEqual(MAX_CANDIDATES_PER_RUN);
    expect(store.added.every((c) => c.commissionPct === 9 && c.postHe.length > 0)).toBe(true);
    // The bar moved forward to the queue.
    expect(store.stages.at(-1)).toBeGreaterThanOrEqual(90);
    expect([...store.stages].sort((a, b) => a - b)).toEqual(store.stages);
    // Saved as hot rows before they are queued, so /p and /go work for them.
    expect(store.saved.map((p) => p.productId)).toEqual(store.added.map((c) => c.productId));
    expect(store.saved.every((p) => p.source === "hot")).toBe(true);
    expect(llmCalls).toHaveLength(Math.ceil(r.added / 3)); // batches of WRITE_BATCH
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

  it("queues nothing new when nothing pays the standard rate", async () => {
    const { deps, store } = setup(0);
    const r = await runFinder("admin", ON, deps);
    expect(r.added).toBe(0);
    expect(store.added).toHaveLength(0);
    expect(r.note).toMatch(/standard rate/);
  });

  it("keeps only products AliExpress ships free to Israel when the switch is on", async () => {
    const { deps, store, fetchMock } = setup();
    const r = await runFinder("admin", DEFAULT_AGENT_SETTINGS, deps);
    const asked = fetchMock.mock.calls.filter(
      ([, init]) =>
        new URLSearchParams(String(init?.body)).get("method") ===
        "aliexpress.affiliate.product.shipping.get",
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(SHIPPING_MAX_CHECKS);
    expect(r.added).toBeGreaterThan(0);
    expect(store.added.every((c) => c.product.shipping?.feeIls === 0)).toBe(true);
    expect(store.added.every((c) => Number(c.productId.slice(-1)) % 2 === 0)).toBe(true);
    // The post says so, from the data.
    expect(store.added.every((c) => c.postHe.includes("משלוח חינם לישראל"))).toBe(true);
  });

  it("bounds a writer call's cost by the model", () => {
    expect(worstCaseCostUsd("claude-haiku-5-5", 10)).toBeLessThan(0.02);
    expect(worstCaseCostUsd("claude-opus-5-5", 10)).toBeGreaterThan(0.1);
    expect(worstCaseCostUsd("unknown-model", 10)).toBe(Number.POSITIVE_INFINITY);
  });
});
