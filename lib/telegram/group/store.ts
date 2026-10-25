// The search group's settings and the weekly polls (owner requests 2026-10-25). Settings live in
// site_settings ("telegram_group", service role only): which chat is the search group, the chats
// the bot was added to (from Telegram's my_chat_member updates, so the admin picks one instead of
// typing an id), and whether the weekly poll is on. Polls in telegram_polls.
import "server-only";
import { serviceClient } from "@/lib/supabase/server";

const KEY = "telegram_group";

export interface SeenChat {
  id: string;
  title: string;
  type: string;
  /** The bot's status there: "administrator", "member", "left", "kicked". */
  status: string;
  at: string;
}

export interface GroupSettings {
  searchChatId: string | null;
  searchChatTitle: string | null;
  seen: SeenChat[];
  pollEnabled: boolean;
  /** Searches a day per member. */
  dailyLimit: number;
}

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  searchChatId: null,
  searchChatTitle: null,
  seen: [],
  pollEnabled: false,
  dailyLimit: 10,
};

export async function readGroupSettings(): Promise<GroupSettings> {
  const { data, error } = await serviceClient()
    .from("site_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  if (error) throw new Error(`telegram group: ${error.message}`);
  const v = (data?.value ?? {}) as Partial<GroupSettings>;
  return {
    searchChatId: typeof v.searchChatId === "string" ? v.searchChatId : null,
    searchChatTitle: typeof v.searchChatTitle === "string" ? v.searchChatTitle : null,
    seen: Array.isArray(v.seen) ? v.seen.slice(0, 20) : [],
    pollEnabled: v.pollEnabled === true,
    dailyLimit:
      typeof v.dailyLimit === "number" && v.dailyLimit >= 1 && v.dailyLimit <= 100
        ? Math.floor(v.dailyLimit)
        : DEFAULT_GROUP_SETTINGS.dailyLimit,
  };
}

export async function saveGroupSettings(patch: Partial<GroupSettings>): Promise<GroupSettings> {
  const next = { ...(await readGroupSettings()), ...patch };
  const { error } = await serviceClient()
    .from("site_settings")
    .upsert({ key: KEY, value: next }, { onConflict: "key" });
  if (error) throw new Error(`telegram group save: ${error.message}`);
  return next;
}

/** Records the bot's place in a chat (my_chat_member), newest first. */
export async function noteChat(chat: Omit<SeenChat, "at">, now = new Date()): Promise<void> {
  const s = await readGroupSettings();
  const seen = [
    { ...chat, at: now.toISOString() },
    ...s.seen.filter((c) => c.id !== chat.id),
  ].slice(0, 20);
  await saveGroupSettings({ seen });
}

// --- Polls ---------------------------------------------------------------------------------------

export interface StoredPoll {
  poll_id: string;
  chat_id: string;
  message_id: number | null;
  question: string;
  options: { text: string; voters: number }[];
  total_voters: number;
  is_closed: boolean;
  sent_at: string;
}

export async function insertPoll(poll: Omit<StoredPoll, "is_closed" | "total_voters">) {
  const { error } = await serviceClient().from("telegram_polls").insert(poll);
  if (error) throw new Error(`telegram poll insert: ${error.message}`);
}

/** A poll's counts from Telegram's "poll" update; a poll that is not ours is ignored. */
export async function updatePoll(poll: {
  id: string;
  options: { text: string; voter_count: number }[];
  total_voter_count: number;
  is_closed: boolean;
}): Promise<void> {
  const { error } = await serviceClient()
    .from("telegram_polls")
    .update({
      options: poll.options.map((o) => ({ text: o.text, voters: o.voter_count })),
      total_voters: poll.total_voter_count,
      is_closed: poll.is_closed,
      updated_at: new Date().toISOString(),
    })
    .eq("poll_id", poll.id);
  if (error) throw new Error(`telegram poll update: ${error.message}`);
}

export async function listPolls(limit = 8): Promise<StoredPoll[]> {
  const { data, error } = await serviceClient()
    .from("telegram_polls")
    .select("poll_id, chat_id, message_id, question, options, total_voters, is_closed, sent_at")
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`telegram polls: ${error.message}`);
  return (data ?? []) as StoredPoll[];
}

export async function lastPollAt(): Promise<Date | null> {
  const [p] = await listPolls(1);
  return p ? new Date(p.sent_at) : null;
}
