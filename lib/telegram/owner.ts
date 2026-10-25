// The owner's private chat with the bot (owner request 2026-10-24: manual stories arrive there at
// their time). Linking without any secret in chat: /admin/meta shows a one-time code, the owner
// sends it to the bot from their own Telegram, and the admin's "check" reads the bot's recent
// messages (getUpdates; the bot has no webhook) for a private message with exactly that code, sent
// after the code was made and within CODE_TTL_MS. Its chat id is stored in site_settings
// ("telegram_owner", service role only). The bot token is only ever in the API's URL path, as
// Telegram requires, and never logged or put in an error.
import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { escapeHtml, telegramConfig } from "./client";

const KEY = "telegram_owner";
/** How long a linking code works. */
export const CODE_TTL_MS = 30 * 60_000;

interface OwnerSetting {
  chatId: string | null;
  code: string | null;
  codeAt: string | null;
  linkedAt: string | null;
}

const EMPTY: OwnerSetting = { chatId: null, code: null, codeAt: null, linkedAt: null };

async function read(): Promise<OwnerSetting> {
  const { data } = await serviceClient()
    .from("site_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<OwnerSetting>;
  return {
    chatId: typeof v.chatId === "string" && /^\d{1,20}$/.test(v.chatId) ? v.chatId : null,
    code: typeof v.code === "string" ? v.code : null,
    codeAt: typeof v.codeAt === "string" ? v.codeAt : null,
    linkedAt: typeof v.linkedAt === "string" ? v.linkedAt : null,
  };
}

async function write(value: OwnerSetting): Promise<void> {
  const { error } = await serviceClient()
    .from("site_settings")
    .upsert({ key: KEY, value }, { onConflict: "key" });
  if (error) throw new Error(`telegram owner: ${error.message}`);
}

/** What /admin/meta shows: linked or not, and a code still waiting. */
export async function ownerTelegramState(): Promise<{
  configured: boolean;
  linked: boolean;
  linkedAt: string | null;
  code: string | null;
}> {
  const s = await read().catch(() => EMPTY);
  const fresh = s.code && s.codeAt && Date.now() - Date.parse(s.codeAt) < CODE_TTL_MS;
  return {
    configured: telegramConfig() !== null,
    linked: s.chatId !== null,
    linkedAt: s.linkedAt,
    code: fresh ? s.code : null,
  };
}

/** A new one-time code ("MZ" and 6 digits). */
export async function newOwnerCode(): Promise<string> {
  const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = `MZ${String(digits).padStart(6, "0")}`;
  const s = await read().catch(() => EMPTY);
  await write({ ...s, code, codeAt: new Date().toISOString() });
  return code;
}

interface Update {
  message?: { date?: number; text?: string; chat?: { id?: number; type?: string } };
}

/** The chat that sent exactly `code` in private, after `since`: pure, tested. */
export function chatWithCode(updates: Update[], code: string, since: Date): string | null {
  for (const u of [...updates].reverse()) {
    const m = u.message;
    if (
      m?.chat?.type === "private" &&
      typeof m.chat.id === "number" &&
      m.text?.trim().toUpperCase() === code &&
      (m.date ?? 0) * 1000 >= since.getTime() - 60_000
    ) {
      return String(m.chat.id);
    }
  }
  return null;
}

export type LinkResult = "linked" | "not-found" | "expired" | "not-configured" | "failed";

/**
 * The webhook's way (lib/telegram/group/handle.ts): a private message that is exactly the waiting
 * code, sent after it was made, links that chat at once. True when it was the code.
 */
export async function linkFromMessage(
  chatId: number,
  text: string,
  date: number,
): Promise<boolean> {
  const s = await read().catch(() => EMPTY);
  if (!s.code || !s.codeAt || Date.now() - Date.parse(s.codeAt) >= CODE_TTL_MS) return false;
  const chat = chatWithCode(
    [{ message: { date, text, chat: { id: chatId, type: "private" } } }],
    s.code,
    new Date(s.codeAt),
  );
  if (!chat) return false;
  await write({ chatId: chat, code: null, codeAt: null, linkedAt: new Date().toISOString() });
  await sendOwnerMessage("✅ החיבור הצליח. מעכשיו סטוריז לפרסום ידני יגיעו לכאן בזמן שלהם.");
  return true;
}

/**
 * The admin's "check": linked already (the webhook linked it when the code arrived), or else the
 * code in the bot's recent messages (getUpdates, only while no webhook is set).
 */
export async function confirmOwnerCode(fetchImpl: typeof fetch = fetch): Promise<LinkResult> {
  const config = telegramConfig();
  if (!config) return "not-configured";
  const s = await read();
  if (s.chatId && !s.code) return "linked";
  if (!s.code || !s.codeAt || Date.now() - Date.parse(s.codeAt) >= CODE_TTL_MS) return "expired";
  try {
    const res = await fetchImpl(
      `https://api.telegram.org/bot${config.token}/getUpdates?allowed_updates=%5B%22message%22%5D`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: Update[] } | null;
    if (!res.ok || !body?.ok) return "failed";
    const chatId = chatWithCode(body.result ?? [], s.code, new Date(s.codeAt));
    if (!chatId) return "not-found";
    await write({ chatId, code: null, codeAt: null, linkedAt: new Date().toISOString() });
    await sendOwnerMessage(
      "✅ החיבור הצליח. מעכשיו סטוריז לפרסום ידני יגיעו לכאן בזמן שלהם.",
      fetchImpl,
    );
    return "linked";
  } catch {
    return "failed";
  }
}

export async function unlinkOwner(): Promise<void> {
  await write(EMPTY);
}

type SendResult = { ok: true } | { ok: false; error: string };

async function send(
  method: "sendMessage" | "sendPhoto" | "sendVideo",
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<SendResult> {
  const config = telegramConfig();
  if (!config) return { ok: false, error: "Telegram is not configured" };
  const s = await read().catch(() => EMPTY);
  if (!s.chatId) return { ok: false, error: "the owner's Telegram is not linked" };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: s.chatId, parse_mode: "HTML", ...payload }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    return res.ok && body?.ok
      ? { ok: true }
      : {
          ok: false,
          error: `Telegram ${res.status}: ${body?.description ?? "no answer"}`.slice(0, 300),
        };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network error" };
  }
}

export function sendOwnerMessage(text: string, fetchImpl: typeof fetch = fetch) {
  return send("sendMessage", { text, link_preview_options: { is_disabled: true } }, fetchImpl);
}

/**
 * A manual story's hand-off: the file (a photo, or a video; Telegram fetches by URL up to 5 MB for
 * a photo and 20 MB for a video, so a bigger file or a refused one falls back to a message with a
 * download link) and the link for the sticker.
 */
export async function sendManualStory(
  story: {
    fileUrl: string;
    video: boolean;
    linkUrl: string | null;
    linkTitle: string | null;
    networks: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const lines = [
    `⏰ <b>הגיע הזמן לסטורי</b> (${escapeHtml(story.networks)})`,
    story.linkTitle ? `🛍️ ${escapeHtml(story.linkTitle)}` : null,
    story.linkUrl ? `🔗 קישור למדבקה:\n${escapeHtml(story.linkUrl)}` : null,
    "שמרו את הקובץ, העלו סטורי מהאפליקציה, הוסיפו מדבקת קישור וכתבו עליו ״קישור שותפים״. אחר כך סמנו ״פרסמתי״ בפאנל.",
  ].filter(Boolean);
  const caption = lines.join("\n\n");
  const media = await send(
    story.video ? "sendVideo" : "sendPhoto",
    { [story.video ? "video" : "photo"]: story.fileUrl, caption },
    fetchImpl,
  );
  if (media.ok) return media;
  return send(
    "sendMessage",
    {
      text: `${caption}\n\n📥 <a href="${escapeHtml(story.fileUrl)}">הורדת הקובץ</a> (הקישור תקף 48 שעות)`,
      link_preview_options: { is_disabled: true },
    },
    fetchImpl,
  );
}
