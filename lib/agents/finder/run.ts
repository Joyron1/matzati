// One run of the product finder (owner request 2026-10-19): scan this run's hot lists, choose the
// candidates (./select.ts), give them hot links, save them as products (so /p and /go work), write
// their posts (./write.ts) within the daily budget, and queue them for the owner's approval.
// Dependencies are passed in, so the run is tested without the network or the database.
import {
  generateLinks,
  getProductDetails,
  HOT_LINK_TYPE,
  queryHotProducts,
} from "@/lib/aliexpress/affiliate";
import type { AliExpressClient } from "@/lib/aliexpress/client";
import { canAskShipping, getShippingToIsrael } from "@/lib/aliexpress/shipping";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { hotLinkSources, withHotLinks } from "@/lib/hot/links";
import { costUsd } from "@/lib/llm/pricing";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import type { AgentSettings } from "../settings";
import {
  categoryTargets,
  MAX_CANDIDATES_PER_RUN,
  scanTargets,
  selectCandidates,
  targetsForRun,
} from "./select";
import { WRITE_BATCH, WRITE_TOKENS, writePosts, type CouponInfo } from "./write";

/** Free shipping: how many products a run may ask about, and until when (the run has 60 s). */
export const SHIPPING_MAX_CHECKS = 14;
export const SHIPPING_DEADLINE_MS = 32_000;
/** Ranked products the free-shipping check goes through. */
const SHIPPING_POOL = 40;

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
  /** How far the run is (0-100) and what it is doing, for the admin's progress bar. */
  progress(id: string, percent: number, stage: string): Promise<void>;
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
  /** The coupons valid for a product now (AliExpress's promo code, the owner's coupons). */
  couponsFor?: (product: AliProduct) => Promise<CouponInfo[]>;
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
  const calls = Math.max(1, Math.ceil(candidates / WRITE_BATCH));
  return (
    costUsd(model, {
      inputTokens: calls * 1_200 + candidates * 350,
      outputTokens: calls * WRITE_TOKENS,
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
  /** An admin's run limited to one catalog category (its key), owner request 2026-10-27. */
  opts: { categoryKey?: string } = {},
): Promise<FinderResult> {
  const { ali, store } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacing = deps.aliSpacingMs ?? 1_100;
  if (trigger === "cron" && !settings.finderEnabled) {
    return { status: "skipped", scanned: 0, added: 0, aliCalls: 0, costUsd: 0, note: "off" };
  }

  const startedAt = now().getTime();
  const runIndex = await store.runCount();
  const runId = await store.startRun(trigger);
  // Never fails the run: the bar is a convenience.
  const step = (percent: number, stage: string) =>
    store.progress(runId, percent, stage).catch(() => undefined);
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
    const oneCategory = Boolean(opts.categoryKey);
    const targets = opts.categoryKey
      ? categoryTargets(opts.categoryKey)
      : targetsForRun(scanTargets(), runIndex);
    if (!targets.length) {
      result.status = "failed";
      result.note = "unknown category";
      return result;
    }
    for (const [i, target] of targets.entries()) {
      await step(
        5 + Math.round((i / targets.length) * 55),
        `סורק רשימה ${i + 1} מתוך ${targets.length}`,
      );
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
    await step(62, "בוחר את המוצרים הנמכרים והמדורגים ביותר");
    const known = await store.knownProductIds([...new Set(found.map((p) => p.productId))]);
    let chosen = selectCandidates(found, known, {
      max: settings.freeShippingOnly ? SHIPPING_POOL : MAX_CANDIDATES_PER_RUN,
      oneCategory,
    });
    if (!chosen.length) {
      result.note = "no new product passed the quality bar, the standard rate and the filters";
      return result;
    }
    // 2b. Free shipping to Israel (owner request 2026-10-23): one product.shipping.get per product,
    // best first, until a full run is found, the checks run out or the run's time does.
    if (settings.freeShippingOnly) {
      const free: AliProduct[] = [];
      let checks = 0;
      for (const p of chosen.filter(canAskShipping)) {
        if (free.length >= MAX_CANDIDATES_PER_RUN || checks >= SHIPPING_MAX_CHECKS) break;
        if (now().getTime() - startedAt > SHIPPING_DEADLINE_MS) break;
        await step(62 + Math.round((checks / SHIPPING_MAX_CHECKS) * 5), "בודק משלוח חינם לישראל");
        await sleep(spacing);
        result.aliCalls++;
        checks++;
        try {
          const shipping = await getShippingToIsrael(ali, p, now());
          if (shipping && shipping.feeIls === 0) free.push({ ...p, shipping });
        } catch (err) {
          console.error(`[finder] shipping ${p.productId}: ${String(err).slice(0, 200)}`);
        }
      }
      chosen = free;
      if (!chosen.length) {
        result.note = `no free shipping to Israel among ${checks} checked`;
        return result;
      }
    }

    // 3. Hot links where AliExpress offers the hot rate (one call); a failure keeps the list's.
    const sources = hotLinkSources(chosen);
    if (sources.length) {
      await step(68, "יוצר קישורי Hot");
      await sleep(spacing);
      result.aliCalls++;
      try {
        const links = await generateLinks(ali, sources, { promotionLinkType: HOT_LINK_TYPE });
        chosen = withHotLinks(chosen, links, now().toISOString());
      } catch (err) {
        console.error(`[finder] hot links: ${String(err).slice(0, 200)}`);
      }
    }
    // 4. Every photo and the video, from one productdetail.get for all of them (the owner exports
    // them for the motion video, owner request 2026-10-23); a failure keeps the list's photos.
    await step(74, "מושך תמונות ווידאו");
    await sleep(spacing);
    result.aliCalls++;
    try {
      const details = await getProductDetails(
        ali,
        chosen.map((p) => p.productId),
        "HE",
      );
      const byId = new Map(details.products.map((d) => [d.productId, d]));
      chosen = chosen.map((p) => {
        const d = byId.get(p.productId);
        if (!d) return p;
        return {
          ...p,
          imageUrls: [...new Set([...p.imageUrls, ...d.imageUrls])],
          videoUrl: d.videoUrl ?? p.videoUrl ?? null,
        };
      });
    } catch (err) {
      console.error(`[finder] details: ${String(err).slice(0, 200)}`);
    }
    const rows = chosen.map((p) => ({ ...p, source: "hot" as const }));
    await step(80, "שומר את המוצרים");
    await store.saveProducts(rows, now());

    // 5. Posts, within the daily budget (else from the data).
    await step(84, "כותב פוסטים");
    const spent = await store.spentTodayUsd(now());
    const affordable =
      deps.llm !== null &&
      spent + worstCaseCostUsd(settings.model, rows.length) <= settings.dailyBudgetUsd;
    const coupons = new Map<string, CouponInfo[]>();
    if (deps.couponsFor) {
      for (const p of rows) coupons.set(p.productId, await deps.couponsFor(p).catch(() => []));
    }
    const written = await writePosts(affordable ? deps.llm : null, rows, coupons);
    if (written.usage && written.model) {
      result.costUsd = costUsd(written.model, written.usage) ?? 0;
      await store.logUsage(written.model, written.usage);
    }
    if (!affordable)
      result.note = deps.llm ? "budget: posts from the data" : "no LLM key: posts from the data";

    // 6. Queue.
    await step(96, "מכניס לתור האישור");
    result.added = await store.insertCandidates(
      runId,
      rows.map((p) => {
        const post = written.posts.get(p.productId)!;
        return {
          productId: p.productId,
          // The standard rate (the hot rate stays in the product, shown as a bonus).
          commissionPct: p.commissionRatePct ?? 0,
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
