// Runs ONE search through the real pipeline (in-memory cache) and reports what it cost.
// Usage: npx tsx --env-file=.env.local scripts/search-smoke.ts ["שאילתה בעברית"]
import { AliExpressClient } from "@/lib/aliexpress/client";
import { aliexpressConfig, llmConfig, usdIlsFallback } from "@/lib/env";
import { fetchUsdIlsRate } from "@/lib/fx/boi";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { costUsd } from "@/lib/llm/pricing";
import { runSearch } from "@/lib/search/pipeline";
import { MemoryStore } from "@/lib/search/store";

const QUERY = process.argv[2] ?? "אוזניות לריצה, עמידות למים, עד 100 ש״ח";

async function main() {
  const cfg = llmConfig();
  // maxRetries 0: this run must make only the calls it reports.
  const llm = new AnthropicProvider(cfg.apiKey, cfg.model, { maxRetries: 0 });
  const ali = new AliExpressClient(aliexpressConfig());
  const t0 = Date.now();
  const { response, meta } = await runSearch({ q: QUERY }, { llm, ali, store: new MemoryStore() });

  console.log(`query: ${QUERY}  (${Date.now() - t0} ms)`);
  console.log(`chips: ${response.chips.map((c) => c.label_he).join(" | ")}`);
  console.log(
    `checked ${response.checked_count}, passed ${response.passed_count}; AliExpress calls ${meta.aliCalls} [${meta.keywordsTried.join(" | ")}]`,
  );
  response.results.forEach((r, i) => {
    console.log(
      `#${i + 1} ₪${r.price_ils} | ${r.positive_feedback_pct}% | ${r.units_sold}/30d | ${r.title_he}\n    ${r.why_he}`,
    );
  });
  const fx = await fetchUsdIlsRate(usdIlsFallback());
  let total = 0;
  for (const u of meta.llmUsage) {
    const usd = costUsd(u.model, u.usage) ?? 0;
    total += usd;
    console.log(
      `${u.kind}: ${u.usage.inputTokens} in + ${u.usage.outputTokens} out = $${usd.toFixed(5)}`,
    );
  }
  console.log(`total $${total.toFixed(5)} ≈ ₪${(total * fx.rate).toFixed(4)}`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
