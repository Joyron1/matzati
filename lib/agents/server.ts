// Server entry points of the agents (owner requests 2026-10-19 and 10-23): a finder run (cron or
// the admin's "run now"), the approved products the site shows (/recommended, the home page),
// approving a candidate (shown on the site at once, given the next Telegram slot), posting what is
// due to Telegram (cron every 15 minutes), and the owner's motion video per product. Server-only.
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
import { postProduct, telegramConfig } from "@/lib/telegram/client";
import type { ResultProduct } from "@/lib/types";
import { runFinder, type FinderResult } from "./finder/run";
import { readAgentSettings, type AgentSettings } from "./settings";
import { nextSlot } from "./schedule";
import {
  decideCandidate,
  dueTelegramPosts,
  getCandidate,
  listCandidates,
  recordTelegram,
  setCandidateVideo,
  SupabaseFinderStore,
  takenTelegramSlots,
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
  /** The Telegram slot the post was given; null when Telegram is off or not configured. */
  telegramAt?: Date | null;
}

/**
 * Approves a candidate with the post as the owner left it: shown on the site at once (it expires
 * the cached list), and, when `telegram` is asked, the admin's switch is on and the channel is
 * configured, given the next free Telegram slot (lib/agents/schedule.ts: fixed times, never Friday
 * 17:00 to Saturday 19:30); the cron posts it then (owner decision 2026-10-23: approval and
 * schedule). Call from a server action that checked requireAdmin().
 */
export async function approveCandidate(
  id: string,
  postHe: string,
  telegram: boolean,
): Promise<DecisionResult> {
  const db = serviceClient();
  const candidate = await getCandidate(db, id);
  if (!candidate) return { ok: false };
  let at: Date | null = null;
  if (telegram) {
    const { settings } = await readAgentSettings(db);
    if (settings.telegramEnabled && telegramConfig()) {
      const now = new Date();
      at = nextSlot(now, await takenTelegramSlots(db, now));
    }
  }
  await decideCandidate(db, id, "approved", postHe, telegram ? at : undefined);
  updateTag(RECOMMENDED_TAG);
  return { ok: true, telegramAt: telegram ? at : undefined };
}

/** Rejects a pending candidate, or takes an approved one off the site (never proposed again). */
export async function rejectCandidate(id: string): Promise<void> {
  await decideCandidate(serviceClient(), id, "rejected");
  updateTag(RECOMMENDED_TAG);
}

// --- The owner's videos (bucket agent-media, private) -------------------------------------------

export const MEDIA_BUCKET = "agent-media";

/** The path a candidate's video is uploaded to: its own folder, one name per upload. */
export function videoPathFor(candidateId: string, now = Date.now()): string {
  return `candidates/${candidateId}/${now}.mp4`;
}

/** A signed upload URL for the admin's browser (the file goes straight to Supabase Storage). */
export async function signedVideoUpload(
  candidateId: string,
): Promise<{ path: string; token: string } | null> {
  const db = serviceClient();
  if (!(await getCandidate(db, candidateId))) return null;
  const path = videoPathFor(candidateId);
  const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return null;
  return { path: data.path, token: data.token };
}

/** Records an uploaded video on its candidate (only a path in the candidate's own folder). */
export async function attachVideo(candidateId: string, path: string): Promise<boolean> {
  if (!path.startsWith(`candidates/${candidateId}/`) || path.includes("..")) return false;
  await setCandidateVideo(serviceClient(), candidateId, path);
  return true;
}

export async function removeVideo(candidateId: string): Promise<void> {
  await setCandidateVideo(serviceClient(), candidateId, null);
}

/** A URL to the video valid for `seconds` (the admin's preview, Telegram's fetch). */
export async function signedVideoUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data } = await serviceClient().storage.from(MEDIA_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

// --- Posting what is due -------------------------------------------------------------------------

export interface PublishSummary {
  due: number;
  posted: number;
  failed: number;
}

/**
 * Posts the approved candidates whose Telegram slot has come (up to 3 a run; the cron runs every
 * 15 minutes): the owner's video when there is one, else the photo. Never in quiet time (the
 * slots already avoid it). A failure is stored and the slot given up. Production only.
 */
export async function publishDue(now = new Date()): Promise<PublishSummary> {
  const summary: PublishSummary = { due: 0, posted: 0, failed: 0 };
  if (deployEnv() !== "production") return summary;
  const config = telegramConfig();
  const db = serviceClient();
  const { settings } = await readAgentSettings(db);
  if (!config || !settings.telegramEnabled) return summary;
  const due = await dueTelegramPosts(db, now);
  summary.due = due.length;
  for (const c of due) {
    const videoUrl = c.video_path ? await signedVideoUrl(c.video_path, 3600) : null;
    const result = await postProduct(config, {
      productId: c.product_id,
      postHe: c.post_he,
      photoUrl: c.product.imageUrls[0] ?? c.product.mainImageUrl,
      videoUrl,
    });
    await recordTelegram(db, c.id, result);
    if (result.ok) summary.posted++;
    else summary.failed++;
  }
  return summary;
}
