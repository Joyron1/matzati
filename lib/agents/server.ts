// Server entry points of the agents (owner requests 2026-10-19 and 10-23): a finder run (cron or
// the admin's "run now"), the approved products the site shows (/recommended, the home page),
// approving a candidate (shown on the site at once, given the next Telegram slot), posting what is
// due to Telegram (cron every 15 minutes), and the owner's motion video per product. Server-only.
import "server-only";
import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import { getProductDetails } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { productForPage } from "@/lib/search/server";
import { SupabaseStore } from "@/lib/search/supabase-store";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { aliexpressConfig, deployEnv, llmConfig } from "@/lib/env";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { parseQuery } from "@/lib/llm/parse";
import type { LlmProvider } from "@/lib/llm/provider";
import { hotTitle } from "@/lib/product-title";
import { toResultProduct } from "@/lib/search/pipeline";
import { serviceClient } from "@/lib/supabase/server";
import { affiliateUrl } from "@/lib/aliexpress/schemas";
import { absoluteUrl } from "@/lib/config/site";
import { postAffiliateLink } from "@/lib/search/server";
import { postProduct, telegramConfig, type ProductPost } from "@/lib/telegram/client";
import { allowedMediaUrl } from "./media";
import type { ResultProduct } from "@/lib/types";
import { isPromoCodeCurrent } from "@/lib/aliexpress/promo-code";
import { couponsForProduct } from "@/lib/coupons/queries";
import { costUsd } from "@/lib/llm/pricing";
import { runFinder, worstCaseCostUsd, type FinderResult } from "./finder/run";
import { ownerCouponAmount, writePosts, type CouponInfo } from "./finder/write";
import { readAgentSettings, type AgentSettings } from "./settings";
import { israelParts, queueEndSlot } from "./schedule";
import {
  decideCandidate,
  dueTelegramPosts,
  getCandidate,
  getCandidateByProduct,
  listCandidates,
  recordTelegram,
  updateCandidatePost,
  setCandidateVideo,
  SupabaseFinderStore,
  takenTelegramSlots,
} from "./store";
import type { Candidate } from "./store";

/** Expired whenever the approved list changes, so /recommended and the home page show it. */
export const RECOMMENDED_TAG = "recommended";

/**
 * Expires the approved list at once. updateTag works only inside a Server Action and throws in a
 * route handler, which made the product page's button (a route) fail right after approving
 * (2026-10-28); there revalidateTag with an immediate expiry does the same.
 */
function expireRecommended(): void {
  try {
    updateTag(RECOMMENDED_TAG);
  } catch {
    revalidateTag(RECOMMENDED_TAG, { expire: 0 });
  }
}

function agentLlm(settings: AgentSettings): LlmProvider | null {
  try {
    const { apiKey } = llmConfig();
    return apiKey ? new AnthropicProvider(apiKey, settings.model, { maxRetries: 1 }) : null;
  } catch {
    return null;
  }
}

function dayMonth(iso: string | null): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  const p = israelParts(new Date(iso));
  return `${p.day}.${p.month}`;
}

/**
 * The coupons valid now for a product, for its post: AliExpress's promo code (while valid by its
 * own dates) and the owner's published coupons for it or sitewide (couponsForProduct).
 */
export async function couponsFor(product: AliProduct, now = new Date()): Promise<CouponInfo[]> {
  const out: CouponInfo[] = [];
  const code = product.promoCode;
  if (code && isPromoCodeCurrent(code, now)) {
    const offer = code.offer;
    out.push({
      code: code.code,
      offer: code.offerText ?? "קוד הנחה של אלי אקספרס",
      min_order_ils: code.minSpend,
      ends: dayMonth(code.endsAt),
      off_ils: offer?.kind === "amount" && offer.currency === "ILS" ? offer.off : null,
      off_pct: offer?.kind === "percent" ? offer.pct : null,
    });
  }
  for (const c of await couponsForProduct(product.productId, now)) {
    out.push({
      code: c.code,
      offer: c.title,
      min_order_ils: c.min_spend_ils,
      ends: dayMonth(c.ends_at),
      ...ownerCouponAmount(c.title),
    });
  }
  return out.slice(0, 3);
}

/** One finder run with the stored settings. Never throws; the run row says what happened. */
export async function runFinderFor(
  trigger: "cron" | "admin",
  categoryKey?: string,
  /** The admin's free text guiding the run (owner request 2026-10-27), parsed like a search. */
  guidanceText?: string,
): Promise<FinderResult> {
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
  // The guidance through the site's parse (one call with the site's model): its English keywords
  // and any price bounds it states ("מעל 50 ש״ח").
  let guidance: { keywords: string; minPriceIls?: number; maxPriceIls?: number } | undefined;
  if (guidanceText?.trim()) {
    try {
      const cfg = llmConfig();
      const out = await parseQuery(
        new AnthropicProvider(cfg.apiKey, cfg.model),
        guidanceText.trim(),
      );
      const store = new SupabaseFinderStore(db);
      for (const u of out.usage) await store.logUsage(out.model, u).catch(() => undefined);
      if (out.parsed?.keywords_en) {
        guidance = {
          keywords: out.parsed.keywords_en,
          ...(out.parsed.min_price_ils ? { minPriceIls: out.parsed.min_price_ils } : {}),
          ...(out.parsed.max_price_ils ? { maxPriceIls: out.parsed.max_price_ils } : {}),
        };
      }
    } catch (err) {
      console.error(`[finder] guidance: ${String(err).slice(0, 200)}`);
    }
    if (!guidance) {
      return {
        status: "failed",
        scanned: 0,
        added: 0,
        aliCalls: 0,
        costUsd: 0,
        note: "the guidance could not be understood",
      };
    }
  }
  return runFinder(
    trigger,
    settings,
    {
      ali: new AliExpressClient(aliexpressConfig()),
      llm: agentLlm(settings),
      store: new SupabaseFinderStore(db),
      couponsFor: (p) => couponsFor(p),
    },
    { ...(categoryKey ? { categoryKey } : {}), ...(guidance ? { guidance } : {}) },
  );
}

/**
 * Writes a pending candidate's post again with the current prompt and coupons (the admin's
 * "כתיבה מחדש"): one writer call with the admin's model, logged and counted in the day's budget
 * like a run's. False when the candidate is unknown, no model is available or the text fell back.
 */
export async function rewriteCandidate(id: string): Promise<boolean> {
  const db = serviceClient();
  const candidate = await getCandidate(db, id);
  if (!candidate) return false;
  const { settings } = await readAgentSettings(db);
  const llm = agentLlm(settings);
  if (!llm) return false;
  const coupons = new Map([[candidate.product_id, await couponsFor(candidate.product)]]);
  const out = await writePosts(llm, [candidate.product], coupons);
  const store = new SupabaseFinderStore(db);
  if (out.usage && out.model) {
    await store.logUsage(out.model, out.usage);
    const cost = costUsd(out.model, out.usage) ?? 0;
    // Counted in the day's agent spend (spentTodayUsd reads agent_runs).
    const runId = await store.startRun("admin");
    await store.finishRun(runId, {
      status: "ok",
      scanned: 0,
      added: 0,
      aliCalls: 0,
      costUsd: cost,
      note: "rewrite of one post",
    });
  }
  const post = out.posts.get(candidate.product_id);
  if (!post || post.fallback) return false;
  await updateCandidatePost(db, id, post.post_he, post.why_he);
  return true;
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
      at = queueEndSlot(now, await takenTelegramSlots(db, now));
    }
  }
  await decideCandidate(db, id, "approved", postHe, telegram ? at : undefined);
  expireRecommended();
  return { ok: true, telegramAt: telegram ? at : undefined };
}

export type PublishNowResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "not-connected" | "already" | "telegram"; error?: string };

/**
 * "פרסום עכשיו" (owner request 2026-10-23, for tests): posts the candidate to Telegram at once,
 * outside the slots and the quiet time (only the scheduled posts keep them). A pending candidate is
 * approved first with the post as the owner left it. Needs the channel configured, not the admin's
 * switch. Call from a server action that checked requireAdmin().
 */
export async function publishNow(id: string, postHe?: string): Promise<PublishNowResult> {
  const config = telegramConfig();
  if (!config) return { ok: false, reason: "not-connected" };
  const db = serviceClient();
  const candidate = await getCandidate(db, id);
  if (!candidate || candidate.status === "rejected") return { ok: false, reason: "missing" };
  if (candidate.telegram_posted_at) return { ok: false, reason: "already" };
  const post = postHe ?? candidate.post_he;
  if (candidate.status === "pending") {
    await decideCandidate(db, id, "approved", post, null);
    expireRecommended();
  }
  const result = await postProduct(config, await productPostOf(candidate, post));
  await recordTelegram(db, id, result);
  return result.ok ? { ok: true } : { ok: false, reason: "telegram", error: result.error };
}

/**
 * What a Telegram post sends (owner request 2026-10-25): every photo of the product (the run's
 * productdetail.get merged them into the snapshot), the owner's video and AliExpress's video (only
 * from AliExpress's media hosts), and the affiliate link straight to AliExpress (renewed when old;
 * /go only when the product has none).
 */
async function productPostOf(c: Candidate, postHe: string): Promise<ProductPost> {
  const p = c.product;
  const own = c.video_path ? await signedVideoUrl(c.video_path, 3600) : null;
  const ali = p.videoUrl && allowedMediaUrl(p.videoUrl) ? p.videoUrl : null;
  const photos = [...p.imageUrls, p.mainImageUrl].filter((u) => !!u && !!allowedMediaUrl(u));
  const direct = (await postAffiliateLink(c.product_id)) ?? affiliateUrl(p.promotionLink) ?? null;
  return {
    productId: c.product_id,
    postHe,
    buyUrl: direct ?? absoluteUrl(`/go/${encodeURIComponent(c.product_id)}?src=telegram`),
    photos,
    videos: [own, ali].filter((v): v is string => !!v),
  };
}

/** Rejects a pending candidate, or takes an approved one off the site (never proposed again). */
export async function rejectCandidate(id: string): Promise<void> {
  await decideCandidate(serviceClient(), id, "rejected");
  expireRecommended();
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
    const result = await postProduct(config, await productPostOf(c, c.post_he));
    await recordTelegram(db, c.id, result);
    if (result.ok) summary.posted++;
    else summary.failed++;
  }
  return summary;
}

// --- "הוספה למומלצים" from the site (owner request 2026-10-27) -----------------------------------

export type RecommendNowResult =
  | {
      ok: true;
      /** scheduled: given the slot after every post already queued (`at`); off: the admin's
       *  Telegram switch is off; not-connected: no channel configured. */
      telegram: "scheduled" | "off" | "not-connected";
      at?: string;
    }
  | { ok: false; reason: "not-production" | "missing" | "already" };

/**
 * Adds a product the admin found on the site (a search's results, the hot lists, recent searches:
 * its /p page) to "המומלצים שלנו" and queues it for the Telegram channel at the END of the queue
 * (owner request 2026-10-28: after every post already scheduled, never posted at once), in the
 * finder's format: every photo and video (one productdetail.get), the post written by the admin's
 * model within the day's budget (else from the data), the affiliate link. A product already proposed
 * is approved as it is; one already scheduled keeps its slot; one already posted is left alone.
 * Production only (dev and preview share the database and the channel).
 */
export async function recommendNow(productId: string): Promise<RecommendNowResult> {
  if (deployEnv() !== "production") return { ok: false, reason: "not-production" };
  const db = serviceClient();
  const existing = await getCandidateByProduct(db, productId);
  if (existing?.telegram_posted_at) return { ok: false, reason: "already" };

  let id = existing?.id ?? null;
  if (!id) {
    // The stored row (a search's or a hot list's), loaded and saved by /p's path when missing.
    const search = new SupabaseStore(db);
    let stored = await search.getProduct(productId);
    if (!stored) {
      await productForPage(productId);
      stored = await search.getProduct(productId);
    }
    if (!stored) return { ok: false, reason: "missing" };
    let product: AliProduct = stored.product;
    // Every photo and the video, as the finder's runs have them.
    try {
      const ali = new AliExpressClient(aliexpressConfig());
      const details = await getProductDetails(ali, [productId], "HE");
      const d = details.products[0];
      if (d) {
        product = {
          ...product,
          imageUrls: [...new Set([...product.imageUrls, ...d.imageUrls])],
          videoUrl: d.videoUrl ?? product.videoUrl ?? null,
          promoCode: d.promoCode ?? product.promoCode ?? null,
        };
      }
    } catch (err) {
      console.error(`[recommend] details ${productId}: ${String(err).slice(0, 200)}`);
    }
    const { settings } = await readAgentSettings(db);
    const store = new SupabaseFinderStore(db);
    const llm = agentLlm(settings);
    const affordable =
      llm !== null &&
      (await store.spentTodayUsd(new Date())) + worstCaseCostUsd(settings.model, 1) <=
        settings.dailyBudgetUsd;
    const coupons = new Map([[productId, await couponsFor(product).catch(() => [])]]);
    const written = await writePosts(affordable ? llm : null, [product], coupons);
    const post = written.posts.get(productId)!;
    const runId = await store.startRun("admin");
    await store.insertCandidates(runId, [
      {
        productId,
        commissionPct: product.commissionRatePct ?? 0,
        product,
        postHe: post.post_he,
        whyHe: post.why_he,
      },
    ]);
    const cost = written.usage && written.model ? (costUsd(written.model, written.usage) ?? 0) : 0;
    if (written.usage && written.model) await store.logUsage(written.model, written.usage);
    await store.finishRun(runId, {
      status: "ok",
      scanned: 0,
      added: 1,
      aliCalls: 1,
      costUsd: cost,
      note: "added from the site",
    });
    id = (await getCandidateByProduct(db, productId))?.id ?? null;
    if (!id) return { ok: false, reason: "missing" };
  }

  const c = (await getCandidate(db, id))!;
  if (c.status === "approved" && c.telegram_due_at) {
    return { ok: true, telegram: "scheduled", at: c.telegram_due_at };
  }
  const { settings } = await readAgentSettings(db);
  if (!telegramConfig()) {
    await decideCandidate(db, id, "approved", c.post_he);
    expireRecommended();
    return { ok: true, telegram: "not-connected" };
  }
  if (!settings.telegramEnabled) {
    await decideCandidate(db, id, "approved", c.post_he);
    expireRecommended();
    return { ok: true, telegram: "off" };
  }
  const now = new Date();
  const at = queueEndSlot(now, await takenTelegramSlots(db, now));
  await decideCandidate(db, id, "approved", c.post_he, at);
  expireRecommended();
  return at
    ? { ok: true, telegram: "scheduled", at: at.toISOString() }
    : { ok: true, telegram: "off" };
}
