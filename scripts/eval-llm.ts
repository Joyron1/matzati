// M3 evaluation through the real search pipeline (lib/search/pipeline.ts) with an in-memory
// cache store. 15 queries from the first round plus 5 held-out ones that no prompt example
// resembles, to measure generalization. Everything is recorded to fixtures/llm/ so tests can
// run offline. Hard cap on LLM calls: 45 (owner approved ~40, 2026-09-27).
// Usage: npx tsx --env-file=.env.local scripts/eval-llm.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { aliexpressConfig, llmConfig, usdIlsFallback } from "@/lib/env";
import { fetchUsdIlsRate } from "@/lib/fx/boi";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { costUsd } from "@/lib/llm/pricing";
import type { LlmProvider } from "@/lib/llm/provider";
import { queryKey } from "@/lib/search/cache-key";
import { runSearch, SearchError, type SearchMeta } from "@/lib/search/pipeline";
import { MemoryStore } from "@/lib/search/store";

export const EVAL_QUERIES = [
  { id: "gift-cook", topic: "gifts", q: "מתנה לאבא שאוהב לבשל עד 200 ש״ח" },
  { id: "kids-toy", topic: "kids", q: "צעצוע לילד בן 3 שמלמד צבעים" },
  { id: "car-holder", topic: "car", q: "מחזיק טלפון לרכב עם טעינה אלחוטית" },
  { id: "home-drawer", topic: "home", q: "מארגן מגירות למטבח" },
  { id: "tech-charger", topic: "tech", q: "מטען מהיר 65W לטלפון ולמחשב נייד" },
  { id: "price-watch", topic: "price", q: "שעון חכם עם דופק בפחות מ־150 שקל" },
  { id: "typo-earbuds", topic: "typos", q: "אוזניות בלוטות לריצה עמידות למיים" },
  { id: "slang-mouse", topic: "slang", q: "משהו שווה לגיימינג, עכבר שקט שלא מרעיש" },
  { id: "kids-bottle", topic: "kids", q: "בקבוק מים לגן שלא נוזל" },
  { id: "home-nightlight", topic: "home", q: "מנורת לילה לחדר ילדים עם חיישן תנועה" },
  { id: "price-range-bag", topic: "price", q: "תיק גב לטיולים בין 80 ל־200 ש״ח עמיד למים" },
  { id: "cheapest-cable", topic: "price", q: "הכי זול: כבל USB-C לאייפון 15" },
  { id: "pair-a", topic: "paraphrase", q: "אוזניות לריצה, עמידות למים, עד 100 ש״ח" },
  { id: "pair-a2", topic: "paraphrase", q: "אוזניות ריצה עמידות במים עד 100 שקל" },
  { id: "pair-b2", topic: "paraphrase", q: "מעמד לפלאפון לאוטו עם טעינה אלחוטית" },
  // Held out: written after the prompts, unlike any prompt example.
  { id: "ho-neck-pillow", topic: "held-out", q: "כרית לצוואר לטיסות ארוכות" },
  { id: "ho-gift-garden", topic: "held-out", q: "מתנה לסבתא שאוהבת לגנן עד 120 ש״ח" },
  { id: "ho-powerbank", topic: "held-out", q: "סוללת גיבוי קטנה לטלפון 10000 מיליאמפר" },
  { id: "ho-slippers", topic: "held-out", q: "נעלי בית חמות לחורף" },
  { id: "ho-speaker", topic: "held-out", q: "רמקול בלוטוס עמיד למים לים בין 50 ל־150 שקל" },
] as const;

const MAX_LLM_CALLS = 45;

class CappedLlm implements LlmProvider {
  calls = 0;
  constructor(private inner: LlmProvider) {}
  get name() {
    return this.inner.name;
  }
  get model() {
    return this.inner.model;
  }
  generateStructured: LlmProvider["generateStructured"] = (req) => {
    if (this.calls >= MAX_LLM_CALLS) throw new Error(`LLM call cap ${MAX_LLM_CALLS} reached`);
    this.calls++;
    return this.inner.generateStructured(req);
  };
}

async function main() {
  const cfg = llmConfig();
  const llm = new CappedLlm(new AnthropicProvider(cfg.apiKey, cfg.model, { maxRetries: 0 }));
  const ali = new AliExpressClient(aliexpressConfig());
  const store = new MemoryStore();
  const records: unknown[] = [];
  const metas: SearchMeta[] = [];
  let lastAli = 0;

  for (const { id, topic, q } of EVAL_QUERIES) {
    // Space searches too: AliExpress bans bursts across calls, not just within one search.
    const wait = lastAli + 1_500 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const t0 = Date.now();
    try {
      const { response, meta } = await runSearch({ q }, { llm, ali, store, aliSpacingMs: 1_500 });
      if (meta.aliCalls) lastAli = Date.now();
      metas.push(meta);
      const parsed = await store.getParse(queryKey(q), new Date());
      records.push({ id, topic, query: q, ms: Date.now() - t0, parsed, meta, response });
      const kept = response.results.filter(
        (r) => !meta.explainRejected.some((x) => x.product_id === r.product_id),
      ).length;
      console.log(
        `${id}: ${response.results.length} results (${response.passed_count} passed of ${response.checked_count}) | cache ${meta.cache} | ali ${meta.aliCalls} [${meta.keywordsTried.join(" | ")}] | lines kept ${kept}/${response.results.length} | ${Date.now() - t0} ms`,
      );
    } catch (err) {
      const message = err instanceof SearchError ? `${err.code}: ${err.message}` : String(err);
      records.push({ id, topic, query: q, error: message });
      console.log(`${id}: ERROR ${message}`);
      if (String(err).includes("call cap")) break;
    }
  }

  const fx = await fetchUsdIlsRate(usdIlsFallback());
  const usages = metas.flatMap((m) => m.llmUsage);
  const total = usages.reduce((s, u) => s + (costUsd(u.model, u.usage) ?? 0), 0);
  const summary = {
    model: cfg.model,
    llmCalls: llm.calls,
    aliexpressCalls: metas.reduce((s, m) => s + m.aliCalls, 0),
    cacheHits: metas.filter((m) => m.cache !== "none").length,
    totalUsd: Number(total.toFixed(5)),
    totalIls: Number((total * fx.rate).toFixed(4)),
    usdIls: fx.rate,
  };
  mkdirSync("fixtures/llm", { recursive: true });
  const file = `fixtures/llm/eval-v2-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, `${JSON.stringify({ summary, records }, null, 2)}\n`);
  console.log(`\n${JSON.stringify(summary, null, 2)}\nsaved ${file}`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
