// The join links of the home page's Telegram section (owner request 2026-10-27): the channel
// (TELEGRAM_CHAT_ID, where approved products are posted) and the search group (picked in
// /admin/agents?tab=group). Read from Telegram itself, so the owner types no link: a public chat's
// t.me/<username>, else its primary invite link (getChat, the bot is an admin of both), else an
// invite link the bot creates once (createChatInviteLink, never exportChatInviteLink, which would
// revoke the owner's own link) and stores in site_settings "telegram_join". Cached a day.
import "server-only";
import { unstable_cache } from "next/cache";
import { serviceClient } from "@/lib/supabase/server";
import { tg } from "./api";
import { telegramConfig, type TelegramConfig } from "./client";
import { readGroupSettings } from "./group/store";

const STORE_KEY = "telegram_join";
export const TELEGRAM_LINKS_TAG = "telegram-links";

export interface TelegramJoinLinks {
  channelUrl: string | null;
  groupUrl: string | null;
  /** Searches a day per member in the group, as the bot counts them. */
  dailyLimit: number;
  /** The weekly poll in the channel is on. */
  pollEnabled: boolean;
}

type Stored = Record<string, { chatId: string; url: string }>;

/** Only Telegram's own join addresses are ever shown. */
export function isJoinUrl(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\/t\.me\/[A-Za-z0-9_+/-]{3,80}$/.test(url);
}

async function readStored(): Promise<Stored> {
  const { data } = await serviceClient()
    .from("site_settings")
    .select("value")
    .eq("key", STORE_KEY)
    .maybeSingle();
  return (data?.value ?? {}) as Stored;
}

async function store(slot: string, chatId: string, url: string): Promise<void> {
  const next = { ...(await readStored()), [slot]: { chatId, url } };
  await serviceClient()
    .from("site_settings")
    .upsert({ key: STORE_KEY, value: next }, { onConflict: "key" });
}

/** The chat's join link; throws when Telegram does not answer (so a failure is not cached). */
async function joinLinkOf(
  config: TelegramConfig,
  slot: string,
  chatId: string,
): Promise<string | null> {
  if (chatId.startsWith("@")) return `https://t.me/${chatId.slice(1)}`;
  const stored = (await readStored())[slot];
  if (stored?.chatId === chatId && isJoinUrl(stored.url)) return stored.url;
  const chat = await tg<{ username?: string; invite_link?: string }>(config, "getChat", {
    chat_id: chatId,
  });
  if (!chat.ok) throw new Error(`getChat ${slot}: ${chat.error}`);
  if (chat.result.username) return `https://t.me/${chat.result.username}`;
  if (isJoinUrl(chat.result.invite_link)) return chat.result.invite_link;
  const made = await tg<{ invite_link?: string }>(config, "createChatInviteLink", {
    chat_id: chatId,
    name: "אתר מצאתי",
  });
  if (!made.ok || !isJoinUrl(made.result.invite_link)) {
    console.error(`[telegram-join] ${slot}: ${made.ok ? "no link" : made.error}`);
    return null;
  }
  await store(slot, chatId, made.result.invite_link);
  return made.result.invite_link;
}

const cachedLinks = unstable_cache(
  async (): Promise<TelegramJoinLinks> => {
    const config = telegramConfig();
    const group = await readGroupSettings();
    if (!config)
      return {
        channelUrl: null,
        groupUrl: null,
        dailyLimit: group.dailyLimit,
        pollEnabled: group.pollEnabled,
      };
    const [channelUrl, groupUrl] = await Promise.all([
      joinLinkOf(config, "channel", config.chatId),
      group.searchChatId ? joinLinkOf(config, "group", group.searchChatId) : null,
    ]);
    return { channelUrl, groupUrl, dailyLimit: group.dailyLimit, pollEnabled: group.pollEnabled };
  },
  ["telegram-join-links-v1"],
  { revalidate: 86_400, tags: [TELEGRAM_LINKS_TAG] },
);

/** The links, or none on any failure (the section then hides). Never throws. */
export async function telegramJoinLinks(): Promise<TelegramJoinLinks> {
  try {
    return await cachedLinks();
  } catch (err) {
    console.error(`[telegram-join] ${err instanceof Error ? err.message : String(err)}`);
    return { channelUrl: null, groupUrl: null, dailyLimit: 10, pollEnabled: false };
  }
}
