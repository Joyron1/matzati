// The search group's and the weekly poll's wiring (owner requests 2026-10-25): handle.ts with the
// real Telegram, model, counters, search, links, collage and coupons; the webhook's setup for the
// admin; and the weekly poll from the agents' cron. Server only.
import "server-only";
import { createHash } from "node:crypto";
import { listPublicCoupons } from "@/lib/coupons/queries";
import { absoluteUrl } from "@/lib/config/site";
import { deployEnv, llmConfig } from "@/lib/env";
import { consumeDailyLlmBudget, withinDailyLimit } from "@/lib/guard/rate-limit";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { collageImage } from "@/lib/og/card";
import { imageDataUri } from "@/lib/og/image";
import { LINK_MODEL } from "@/lib/search/from-input";
import { guardEnv, postAffiliateLink, searchForRequest } from "@/lib/search/server";
import { serviceClient } from "@/lib/supabase/server";
import { tg, webhookSecret } from "../api";
import { telegramConfig } from "../client";
import { linkFromMessage } from "../owner";
import { isProductSearch } from "./classify";
import { describeProducts } from "./describe";
import { couponsHtml, type GroupDeps, type SearchOutcome } from "./handle";
import { POLL_QUESTION, pollDue, pollOptions } from "./poll";
import { insertPoll, lastPollAt, noteChat, readGroupSettings, updatePoll } from "./store";

/** Messages the model may check per member per day (chat cannot run up its cost). */
const CHECKS_PER_DAY = 30;

/** A member's salted hash: the Telegram id is never stored, logged or used as a key. */
function memberHash(userId: number): string {
  return createHash("sha256")
    .update(`tg:${userId}:${guardEnv().ipHashSalt}`)
    .digest("hex")
    .slice(0, 32);
}

export function groupDeps(): GroupDeps | null {
  const config = telegramConfig();
  if (!config) return null;
  return {
    async searchChatId() {
      return (await readGroupSettings()).searchChatId;
    },
    async send(method, payload, photo) {
      const r = await tg<{ message_id?: number }>(config, method, payload, {
        file: photo
          ? {
              field: "photo",
              name: "matzati.jpg",
              blob: new Blob([new Uint8Array(photo)], { type: "image/jpeg" }),
            }
          : undefined,
      });
      return r.ok ? { ok: true, messageId: r.result?.message_id } : { ok: false, error: r.error };
    },
    async isProductSearch(text) {
      const db = serviceClient();
      if (!(await consumeDailyLlmBudget(db, new Date(), guardEnv().dailyCap))) return true;
      const cfg = llmConfig();
      const out = await isProductSearch(new AnthropicProvider(cfg.apiKey, LINK_MODEL), text);
      return out.isSearch;
    },
    async withinLimit(counter, userId) {
      const limit = counter === "search" ? (await readGroupSettings()).dailyLimit : CHECKS_PER_DAY;
      return withinDailyLimit(
        serviceClient(),
        counter === "search" ? "tg" : "tgc",
        memberHash(userId),
        limit,
        new Date(),
      );
    },
    async search(q, userId): Promise<SearchOutcome> {
      // The site's search, per member (its own hourly and daily limits count this member, not
      // Telegram's servers), never listed on /searches (typed: false).
      const headers = new Headers({ "x-forwarded-for": `tg:${memberHash(userId)}` });
      const out = await searchForRequest({ q, typed: false, mode: "match" }, headers);
      if (!out.ok) {
        const error =
          out.error === "rate_limited" || out.error === "capacity"
            ? out.error
            : out.error === "invalid_query"
              ? "invalid"
              : "unavailable";
        return { ok: false, error };
      }
      const r = out.response;
      // Only the exact matches: "less matching" products are for the site's wide view.
      const exact = r.match ? (r.exact_count ?? 0) : r.results.length;
      return { ok: true, products: r.results.slice(0, exact) };
    },
    async linkFor(productId) {
      return (
        (await postAffiliateLink(productId)) ??
        absoluteUrl(`/go/${encodeURIComponent(productId)}?src=telegram_group`)
      );
    },
    async describe(products) {
      const db = serviceClient();
      if (!(await consumeDailyLlmBudget(db, new Date(), guardEnv().dailyCap))) return new Map();
      const cfg = llmConfig();
      return describeProducts(
        new AnthropicProvider(cfg.apiKey, LINK_MODEL),
        products.map((p) => ({ id: p.product_id, title: p.title_en || p.title_he })),
      );
    },
    async collage(products) {
      try {
        const photos = await Promise.all(products.map((p) => imageDataUri(p.image_urls[0])));
        return await collageImage(photos);
      } catch (err) {
        console.error(`[telegram-group] collage: ${String(err).slice(0, 200)}`);
        return null;
      }
    },
    async couponsText() {
      const { active } = await listPublicCoupons(new Date());
      return couponsHtml(active, absoluteUrl("/coupons"));
    },
    siteSearchUrl: (q) => absoluteUrl(`/search?q=${encodeURIComponent(q)}`),
    noteChat: (chat) => noteChat(chat),
    async knownChat(chatId) {
      return (await readGroupSettings()).seen.some((c) => c.id === chatId);
    },
    async chatStatus(chatId) {
      const me = await tg<{ id: number }>(config, "getMe", {});
      if (!me.ok) return null;
      const member = await tg<{ status: string }>(config, "getChatMember", {
        chat_id: chatId,
        user_id: me.result.id,
      });
      return member.ok ? member.result.status : null;
    },
    updatePoll: (poll) => updatePoll(poll),
    linkOwner: (chatId, text, date) => linkFromMessage(chatId, text, date),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (event, detail) =>
      console.error(
        `[${event}] ${String(detail instanceof Error ? detail.message : detail).slice(0, 300)}`,
      ),
  };
}

// --- The webhook (the admin's "חיבור הבוט") ------------------------------------------------------

export const WEBHOOK_PATH = "/api/telegram/webhook";

export async function connectWebhook(): Promise<{ ok: boolean; error?: string }> {
  const config = telegramConfig();
  if (!config) return { ok: false, error: "not-configured" };
  const r = await tg(config, "setWebhook", {
    url: absoluteUrl(WEBHOOK_PATH),
    secret_token: webhookSecret(config.token),
    allowed_updates: ["message", "callback_query", "my_chat_member", "poll"],
    drop_pending_updates: true,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function webhookStatus(): Promise<{
  connected: boolean;
  pending: number;
  lastError: string | null;
} | null> {
  const config = telegramConfig();
  if (!config) return null;
  const r = await tg<{ url?: string; pending_update_count?: number; last_error_message?: string }>(
    config,
    "getWebhookInfo",
    {},
  );
  if (!r.ok) return null;
  return {
    connected: r.result.url === absoluteUrl(WEBHOOK_PATH),
    pending: r.result.pending_update_count ?? 0,
    lastError: r.result.last_error_message ?? null,
  };
}

// --- The weekly poll ------------------------------------------------------------------------------

/** Sends the poll to the channel now. */
export async function sendPoll(now = new Date()): Promise<{ ok: boolean; error?: string }> {
  const config = telegramConfig();
  if (!config) return { ok: false, error: "not-configured" };
  const options = pollOptions(now);
  const r = await tg<{ message_id: number; poll?: { id: string } }>(config, "sendPoll", {
    chat_id: config.chatId,
    question: POLL_QUESTION,
    options: options.map((text) => ({ text })),
    is_anonymous: true,
    allows_multiple_answers: true,
  });
  if (!r.ok || !r.result.poll) return { ok: false, error: r.ok ? "no poll in answer" : r.error };
  await insertPoll({
    poll_id: r.result.poll.id,
    chat_id: config.chatId,
    message_id: r.result.message_id,
    question: POLL_QUESTION,
    options: options.map((text) => ({ text, voters: 0 })),
    sent_at: now.toISOString(),
  });
  return { ok: true };
}

/** The agents' cron: the week's poll once its Sunday 12:00 has come (production, switched on). */
export async function sendWeeklyPollIfDue(now = new Date()): Promise<boolean> {
  if (deployEnv() !== "production" || !telegramConfig()) return false;
  const s = await readGroupSettings();
  if (!s.pollEnabled || !pollDue(now, await lastPollAt())) return false;
  const r = await sendPoll(now);
  if (!r.ok) console.error(`[telegram-poll] ${r.error}`);
  return r.ok;
}
