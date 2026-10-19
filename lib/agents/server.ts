// Server entry points of the agents (owner request 2026-10-19): a finder run (cron or the admin's
// "run now"), the approved products the site shows (/recommended, the home page), and approving a
// candidate (shown on the site at once, posted to Telegram when that is on). Server-only.
import "server-only";
import { unstable_cache, updateTag } from "next/cache";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { aliexpressConfig, deployEnv, llmConfig } from "@/lib/env";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import type { LlmProvider } from "@/lib/llm/provider";
import { hotTitle } from "@/lib/product-title";
import { toResultProduct } from "@/lib/search/pipeline";
import { serviceClient } from "@/lib/supabase/server";
import { postProduct, telegramConfig, type TelegramResult } from "@/lib/telegram/client";
import type { ResultProduct } from "@/lib/types";
import { runFinder, type FinderResult } from "./finder/run";
import { readAgentSettings, type AgentSettings } from "./settings";
import {
  decideCandidate,
  getCandidate,
  listCandidates,
  recordTelegram,
  SupabaseFinderStore,
} from "./store";

/** Expired whenever the approved list changes, so /recommended and the home page show it. */
export const RECOMMENDED_TAG = "recommended";

function agentLlm(settings: AgentSettings): LlmProvider | null {
  try {
    const { apiKey } = llmConfig();
    return apiKey ? new AnthropicProvider(apiKey, settings.model, { maxRetries: 1 }) : null;
  } catch {
    return null;
  }
}

/** One finder run with the stored settings. Never throws; the run row says what happened. */
export async function runFinderFor(trigger: "cron" | "admin"): Promise<FinderResult> {
  // Dev and preview share production's database: only the live site fills the owner's queue.
  if (deployEnv() !== "production") {
    return {
      status: "skipped",
      scanned: 0,
      added: 0,
      aliCalls: 0,
      costUsd: 0,
      note: "not production",
    };
  }
  const db = serviceClient();
  const { settings } = await readAgentSettings(db);
  return runFinder(trigger, settings, {
    ali: new AliExpressClient(aliexpressConfig()),
    llm: agentLlm(settings),
    store: new SupabaseFinderStore(db),
  });
}

// --- The site's recommended products ------------------------------------------------------------

export interface RecommendedProduct extends ResultProduct {
  /** When the owner approved it (ISO). */
  approved_at: string | null;
  commission_pct: number;
  /** When its data was last checked at AliExpress (products.updated_at, ISO). */
  checked_at: string | null;
}

/** The newest approved products, with the stored row's data when it is newer than the snapshot. */
async function loadRecommended(limit: number): Promise<RecommendedProduct[]> {
  const db = serviceClient();
  const approved = await listCandidates(db, "approved", limit);
  if (!approved.length) return [];
  const { data } = await db
    .from("products")
    .select("product_id, data, updated_at")
    .in(
      "product_id",
      approved.map((c) => c.product_id),
    );
  const rows = new Map(
    (data ?? []).map((r) => [
      r.product_id as string,
      r as { data: AliProduct; updated_at: string },
    ]),
  );
  return approved.map((c) => {
    const row = rows.get(c.product_id);
    const p = row?.data && typeof row.data === "object" ? { ...c.product, ...row.data } : c.product;
    const base = toResultProduct(p, undefined);
    return {
      ...base,
      title_he: hotTitle(p.title),
      why_he: "",
      approved_at: c.decided_at,
      commission_pct: c.commission_pct,
      checked_at: row?.updated_at ?? null,
    };
  });
}

/** Cached an hour and expired by every approval or removal (RECOMMENDED_TAG). */
export const recommendedProducts = unstable_cache(
  async (limit = 60): Promise<RecommendedProduct[]> => {
    try {
      return await loadRecommended(limit);
    } catch (err) {
      console.error(`[recommended] ${String(err).slice(0, 300)}`);
      return [];
    }
  },
  ["recommended-products", "1"],
  { revalidate: 3600, tags: [RECOMMENDED_TAG] },
);

// --- The admin's decisions ----------------------------------------------------------------------

export interface DecisionResult {
  ok: boolean;
  /** Set when the product was also sent to Telegram (or that failed). */
  telegram?: TelegramResult | "off";
}

/**
 * Approves a candidate with the post as the owner left it: shown on the site at once, and posted
 * to Telegram when `telegram` is asked, the admin's switch is on and the channel is configured.
 * Call from a server action that checked requireAdmin() (it expires the cached list).
 */
export async function approveCandidate(
  id: string,
  postHe: string,
  telegram: boolean,
): Promise<DecisionResult> {
  const db = serviceClient();
  const candidate = await getCandidate(db, id);
  if (!candidate) return { ok: false };
  await decideCandidate(db, id, "approved", postHe);
  updateTag(RECOMMENDED_TAG);
  if (!telegram) return { ok: true };
  const { settings } = await readAgentSettings(db);
  const config = telegramConfig();
  if (!settings.telegramEnabled || !config) return { ok: true, telegram: "off" };
  const photoUrl = candidate.product.imageUrls[0] ?? candidate.product.mainImageUrl;
  const result = await postProduct(config, { productId: candidate.product_id, postHe, photoUrl });
  await recordTelegram(db, id, result);
  return { ok: true, telegram: result };
}

/** Rejects a pending candidate, or takes an approved one off the site (never proposed again). */
export async function rejectCandidate(id: string): Promise<void> {
  await decideCandidate(serviceClient(), id, "rejected");
  updateTag(RECOMMENDED_TAG);
}
