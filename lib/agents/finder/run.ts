// One run of the product finder (owner request 2026-10-19): scan this run's hot lists, choose the
// candidates (./select.ts), give them hot links, save them as products (so /p and /go work), write
// their posts (./write.ts) within the daily budget, and queue them for the owner's approval.
// Dependencies are passed in, so the run is tested without the network or the database.
import { generateLinks, HOT_LINK_TYPE, queryHotProducts } from "@/lib/aliexpress/affiliate";
import type { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { hotLinkSources, withHotLinks } from "@/lib/hot/links";
import { costUsd } from "@/lib/llm/pricing";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import type { AgentSettings } from "../settings";
import {
  commissionOf,
  MAX_CANDIDATES_PER_RUN,
  scanTargets,
  selectCandidates,
  targetsForRun,
} from "./select";
import { WRITE_TOKENS, writePosts } from "./write";

export interface NewCandidate {
  productId: string;
  commissionPct: number;
  product: AliProduct;
  postHe: string;
  whyHe: string;
}

/** What a run reads and writes (lib/agents/store.ts against Supabase; a fake in tests). */
export interface FinderStore {
  /** How many finder runs started before (the rotation of the hot lists). */
  runCount(): Promise<number>;
  /** USD the agents spent on the LLM since the start of this Israel day. */
  spentTodayUsd(now: Date): Promise<number>;
  /** The ids among `ids` already proposed, whatever became of them. */
  knownProductIds(ids: string[]): Promise<Set<string>>;
  startRun(trigger: "cron" | "admin"): Promise<string>;
  finishRun(
    id: string,
    result: {
      status: "ok" | "failed" | "skipped";
      scanned: number;
      added: number;
      aliCalls: number;
      costUsd: number;
      note: string | null;
    },
  ): Promise<void>;
  insertCandidates(runId: string, candidates: NewCandidate[]): Promise<number>;
  /** The products as hot rows (AliExpress's Hebrew data; rows with a title of ours left alone). */
  saveProducts(products: AliProduct[], checkedAt: Date): Promise<void>;
  logUsage(model: string, usage: LlmUsage): Promise<void>;
}

export interface FinderDeps {
  ali: AliExpressClient;
  /** Built for the model the admin chose; null when no API key is configured. */
  llm: LlmProvider | null;
  store: FinderStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  aliSpacingMs?: number;
}

export interface FinderResult {
  status: "ok" | "failed" | "skipped";
  scanned: number;
  added: number;
  aliCalls: number;
  costUsd: number;
  note: string | null;
}

/** The most one writer call may cost with `model`, to keep a run inside the daily budget. */
export function worstCaseCostUsd(model: string, candidates: number): number {
  const input = 600 + candidates * 250;
  return (
    costUsd(model, {
      inputTokens: input,
      outputTokens: WRITE_TOKENS,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }) ?? Number.POSITIVE_INFINITY
  );
}

/**
 * Runs the finder once. `trigger` "cron" runs only while the admin switched the finder on; an
 * admin's "run now" runs either way. A daily budget of 0, or one already spent, still queues
 * candidates, with posts built from the data (no LLM call).
 */
export async function runFinder(
  trigger: "cron" | "admin",
  settings: AgentSettings,
  deps: FinderDeps,
): Promise<FinderResult> {
  const { ali, store } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacing = deps.aliSpacingMs ?? 1_100;
  if (trigger === "cron" && !settings.finderEnabled) {
    return { status: "skipped", scanned: 0, added: 0, aliCalls: 0, costUsd: 0, note: "off" };
  }

  const runIndex = await store.runCount();
  const runId = await store.startRun(trigger);
  const result: FinderResult = {
    status: "ok",
    scanned: 0,
    added: 0,
    aliCalls: 0,
    costUsd: 0,
    note: null,
  };
  try {
    // 1. Scan: each list once, spaced; a failed list is skipped (another run will reach it).
    const found: AliProduct[] = [];
    const failed: string[] = [];
    for (const target of targetsForRun(scanTargets(), runIndex)) {
      if (result.aliCalls > 0) await sleep(spacing);
      result.aliCalls++;
      try {
        const page = await queryHotProducts(ali, {
          categoryId: target.categoryId,
          pageNo: target.pageNo,
          language: "HE",
        });
        found.push(...page.products);
      } catch (err) {
        failed.push(`${target.categoryId}:${target.pageNo}`);
        console.error(
          `[finder] hot list ${target.categoryId} p${target.pageNo}: ${String(err).slice(0, 200)}`,
        );
      }
    }
    result.scanned = found.length;
    if (!found.length) {
      result.status = failed.length ? "failed" : "ok";
      result.note = failed.length ? `no list answered (${failed.join(", ")})` : "nothing found";
      return result;
    }

    // 2. Choose: never a product proposed before.
    const known = await store.knownProductIds([...new Set(found.map((p) => p.productId))]);
    let chosen = selectCandidates(found, known, { max: MAX_CANDIDATES_PER_RUN });
    if (!chosen.length) {
      result.note = "no new product paid 20% or more and passed the filters";
      return result;
    }

    // 3. Hot links where AliExpress offers the hot rate (one call); a failure keeps the list's.
    const sources = hotLinkSources(chosen);
    if (sources.length) {
      await sleep(spacing);
      result.aliCalls++;
      try {
        const links = await generateLinks(ali, sources, { promotionLinkType: HOT_LINK_TYPE });
        chosen = withHotLinks(chosen, links, now().toISOString());
      } catch (err) {
        console.error(`[finder] hot links: ${String(err).slice(0, 200)}`);
      }
    }
    const rows = chosen.map((p) => ({ ...p, source: "hot" as const }));
    await store.saveProducts(rows, now());

    // 4. Posts, within the daily budget (else from the data).
    const spent = await store.spentTodayUsd(now());
    const affordable =
      deps.llm !== null &&
      spent + worstCaseCostUsd(settings.model, rows.length) <= settings.dailyBudgetUsd;
    const written = await writePosts(affordable ? deps.llm : null, rows);
    if (written.usage && written.model) {
      result.costUsd = costUsd(written.model, written.usage) ?? 0;
      await store.logUsage(written.model, written.usage);
    }
    if (!affordable)
      result.note = deps.llm ? "budget: posts from the data" : "no LLM key: posts from the data";

    // 5. Queue.
    result.added = await store.insertCandidates(
      runId,
      rows.map((p) => {
        const post = written.posts.get(p.productId)!;
        return {
          productId: p.productId,
          commissionPct: commissionOf(p) ?? 0,
          product: p,
          postHe: post.post_he,
          whyHe: post.why_he,
        };
      }),
    );
    return result;
  } catch (err) {
    result.status = "failed";
    result.note = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(
      0,
      300,
    );
    return result;
  } finally {
    await store.finishRun(runId, result).catch((err: unknown) => {
      console.error(`[finder] finishRun: ${String(err).slice(0, 200)}`);
    });
  }
}
