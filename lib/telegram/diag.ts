// What reached the Telegram webhook lately (2026-10-27: the search group never appeared in the
// admin's tab, and Vercel's logs are not open to the owner). Each update is recorded in
// site_settings ("telegram_diag", service role only, the last 15): its kind, the chat's type, id
// and title (a group's, never a person's name), and an error when handling it failed. The search
// group tab shows them. Never a message's text or a member's id.
import "server-only";
import { serviceClient } from "@/lib/supabase/server";

const KEY = "telegram_diag";
const KEEP = 15;

export interface TgDiagEvent {
  at: string;
  kind: string;
  chatType?: string;
  chatId?: string;
  chatTitle?: string;
  error?: string;
}

export async function readTgDiag(): Promise<TgDiagEvent[]> {
  const { data } = await serviceClient()
    .from("site_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  const v = data?.value as { events?: TgDiagEvent[] } | null;
  return Array.isArray(v?.events) ? v.events : [];
}

export async function recordTgDiag(event: Omit<TgDiagEvent, "at">): Promise<void> {
  try {
    const next = [{ ...event, at: new Date().toISOString() }, ...(await readTgDiag())].slice(
      0,
      KEEP,
    );
    await serviceClient()
      .from("site_settings")
      .upsert({ key: KEY, value: { events: next } }, { onConflict: "key" });
  } catch {
    // A diagnostic must never break the webhook.
  }
}

/** The update's kind and chat, for the record (no text, no person). */
export function updateSummary(u: {
  message?: { chat: { id: number; type: string; title?: string } };
  callback_query?: unknown;
  my_chat_member?: { chat: { id: number; type: string; title?: string } };
  poll?: unknown;
}): Omit<TgDiagEvent, "at"> {
  const chat = u.message?.chat ?? u.my_chat_member?.chat;
  const kind = u.message
    ? "message"
    : u.my_chat_member
      ? "my_chat_member"
      : u.callback_query
        ? "callback_query"
        : u.poll
          ? "poll"
          : "other";
  if (!chat) return { kind };
  const group = chat.type !== "private";
  return {
    kind,
    chatType: chat.type,
    ...(group ? { chatId: String(chat.id), chatTitle: (chat.title ?? "").slice(0, 80) } : {}),
  };
}
