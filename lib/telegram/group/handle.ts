// The Telegram bot's updates (owner requests 2026-10-25), from the webhook:
// - In the search group: a member writes what they want; the free rules (filter.ts) and then the
//   cheap model (classify.ts) decide whether it is a product search. Not a search: a short note as
//   a reply, then both are deleted. A search, within the member's daily limit: the site's search
//   ("match" mode: exact matches first by trust tier, AliExpress's Hebrew titles, no explain call),
//   then one photo (the collage of the first five, numbered) with the caption (format.ts) and the
//   buttons "חיפוש רחב באתר" and "קופונים", as a reply to the member's message.
// - The "קופונים" button: the coupons valid now, as a reply in the chat.
// - my_chat_member: where the bot was added (the admin then picks the search group).
// - poll: the weekly poll's counts.
// - A private message with the owner's linking code (lib/telegram/owner.ts).
// Every outside call is in `deps`, so this is tested without the network.
import { escapeHtml } from "../client";
import { ruleVerdict, rejectNote } from "./filter";
import {
  answerButtons,
  groupCaption,
  GROUP_RESULTS,
  noResultsText,
  searchingText,
  type GroupProduct,
} from "./format";
import type { ResultProduct } from "@/lib/types";

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  /** Joins, leaves, pins and the like: not written by a member. */
  new_chat_members?: unknown[];
  left_chat_member?: unknown;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string; user: TgUser } };
  poll?: {
    id: string;
    options: { text: string; voter_count: number }[];
    total_voter_count: number;
    is_closed: boolean;
  };
}

export type SearchOutcome =
  | { ok: true; products: ResultProduct[] }
  | { ok: false; error: "rate_limited" | "capacity" | "unavailable" | "invalid" };

export interface GroupDeps {
  /** The chat that is the search group, or null while none was picked. */
  searchChatId(): Promise<string | null>;
  /** Telegram calls (see lib/telegram/api.ts); photo as bytes. */
  send(
    method: string,
    payload: Record<string, unknown>,
    photo?: Buffer,
  ): Promise<{
    ok: boolean;
    messageId?: number;
    error?: string;
  }>;
  /** The cheap model's yes/no (true when it fails: the search is the real check). */
  isProductSearch(text: string): Promise<boolean>;
  /** Counts the member's message toward a daily limit; false past it. */
  withinLimit(counter: "search" | "check", userId: number): Promise<boolean>;
  search(q: string, userId: number): Promise<SearchOutcome>;
  /** The product's affiliate link (or /go). */
  linkFor(productId: string): Promise<string>;
  /** A clean short name and a one-line description per product id (describe.ts); {} on failure. */
  describe(products: ResultProduct[]): Promise<Map<string, { name: string; line: string | null }>>;
  /** The collage of up to five products, or null when it could not be drawn. */
  collage(products: ResultProduct[]): Promise<Buffer | null>;
  /** The coupons valid now, as Telegram HTML; null when there are none. */
  couponsText(): Promise<string | null>;
  /** The site's results page for this query. */
  siteSearchUrl(q: string): string;
  noteChat(chat: { id: string; title: string; type: string; status: string }): Promise<void>;
  /** Whether the bot already knows this chat (recorded by my_chat_member or a message). */
  knownChat(chatId: string): Promise<boolean>;
  /** The bot's status in a chat ("administrator", "member", ...), from getChatMember. */
  chatStatus(chatId: number): Promise<string | null>;
  updatePoll(poll: NonNullable<TgUpdate["poll"]>): Promise<void>;
  /** The owner's linking code, when a private message is it. */
  linkOwner(chatId: number, text: string, date: number): Promise<boolean>;
  /** Waits (the short notes are deleted after a few seconds). */
  sleep(ms: number): Promise<void>;
  log(event: string, detail: unknown): void;
}

/** How long a "not a search" note stays before it and the message are deleted. */
export const NOTE_MS = 12_000;

const replyTo = (m: TgMessage) => ({
  reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
});

async function noteThenDelete(m: TgMessage, text: string, deps: GroupDeps): Promise<void> {
  const note = await deps.send("sendMessage", {
    chat_id: m.chat.id,
    text,
    ...replyTo(m),
    link_preview_options: { is_disabled: true },
  });
  await deps.sleep(NOTE_MS);
  await deps.send("deleteMessage", { chat_id: m.chat.id, message_id: m.message_id });
  if (note.messageId) {
    await deps.send("deleteMessage", { chat_id: m.chat.id, message_id: note.messageId });
  }
}

/** Removes a message at once (no note): joins, stickers, photos, other bots. */
async function remove(m: TgMessage, deps: GroupDeps): Promise<void> {
  await deps.send("deleteMessage", { chat_id: m.chat.id, message_id: m.message_id });
}

async function onGroupMessage(m: TgMessage, deps: GroupDeps): Promise<void> {
  if (!m.from || m.from.is_bot) return;
  if (m.new_chat_members || m.left_chat_member) return remove(m, deps);
  if (typeof m.text !== "string") {
    return noteThenDelete(m, rejectNote("chat"), deps);
  }
  const verdict = ruleVerdict(m.text);
  if (verdict.kind === "reject") return noteThenDelete(m, rejectNote(verdict.reason), deps);

  // The model's check has its own (higher) daily count, so chat cannot run up its cost.
  if (!(await deps.withinLimit("check", m.from.id))) {
    return noteThenDelete(m, "🙂 הגעתם למספר ההודעות היומי בקבוצה. נתראה מחר!", deps);
  }
  if (!(await deps.isProductSearch(verdict.query))) {
    return noteThenDelete(m, rejectNote("not_product"), deps);
  }
  if (!(await deps.withinLimit("search", m.from.id))) {
    return noteThenDelete(
      m,
      "🙂 הגעתם לחיפושים של היום בקבוצה. אפשר להמשיך לחפש באתר, או לחזור לכאן מחר.",
      deps,
    );
  }

  const q = verdict.query;
  // A first answer at once (owner request 2026-10-27), removed when the results are in.
  const searching = await deps.send("sendMessage", {
    chat_id: m.chat.id,
    text: searchingText(q),
    parse_mode: "HTML",
    ...replyTo(m),
  });
  const done = async () => {
    if (searching.messageId) {
      await deps.send("deleteMessage", { chat_id: m.chat.id, message_id: searching.messageId });
    }
  };
  await deps.send("sendChatAction", { chat_id: m.chat.id, action: "upload_photo" });
  const out = await deps.search(q, m.from.id);
  const buttons = answerButtons(deps.siteSearchUrl(q));
  if (!out.ok) {
    const text =
      out.error === "rate_limited"
        ? "🙂 יותר מדי חיפושים בזמן קצר. נסו שוב בעוד כמה דקות."
        : out.error === "capacity"
          ? "החיפוש עמוס היום. נסו שוב מחר, או חפשו באתר."
          : "משהו השתבש בחיפוש. נסו שוב בעוד רגע.";
    await done();
    return noteThenDelete(m, text, deps);
  }
  if (!out.products.length) {
    await done();
    await deps.send("sendMessage", {
      chat_id: m.chat.id,
      text: noResultsText(q),
      parse_mode: "HTML",
      ...replyTo(m),
      reply_markup: buttons,
    });
    return;
  }

  const shown = out.products.slice(0, GROUP_RESULTS);
  const [links, described, photo] = await Promise.all([
    Promise.all(shown.map((p) => deps.linkFor(p.product_id))),
    deps.describe(shown).catch(() => new Map<string, { name: string; line: string | null }>()),
    deps.collage(shown),
  ]);
  const items: GroupProduct[] = shown.map((product, i) => {
    const d = described.get(product.product_id);
    return { product, link: links[i]!, ...(d ? { name: d.name, line: d.line } : {}) };
  });
  const caption = groupCaption(q, items);
  await done();
  if (photo) {
    const sent = await deps.send(
      "sendPhoto",
      { chat_id: m.chat.id, caption, parse_mode: "HTML", ...replyTo(m), reply_markup: buttons },
      photo,
    );
    if (sent.ok) return;
    deps.log("telegram_group_photo", sent.error);
  }
  // No collage (or Telegram refused it): the same answer as text.
  await deps.send("sendMessage", {
    chat_id: m.chat.id,
    text: caption,
    parse_mode: "HTML",
    ...replyTo(m),
    reply_markup: buttons,
    link_preview_options: { is_disabled: true },
  });
}

async function onCallback(q: NonNullable<TgUpdate["callback_query"]>, deps: GroupDeps) {
  if (q.data !== "coupons") {
    await deps.send("answerCallbackQuery", { callback_query_id: q.id });
    return;
  }
  const text = await deps.couponsText();
  if (!text || !q.message) {
    await deps.send("answerCallbackQuery", {
      callback_query_id: q.id,
      text: "אין כרגע קופונים פעילים. שווה לבדוק שוב לפני המבצעים 🙂",
      show_alert: true,
    });
    return;
  }
  await deps.send("answerCallbackQuery", { callback_query_id: q.id });
  await deps.send("sendMessage", {
    chat_id: q.message.chat.id,
    text,
    parse_mode: "HTML",
    reply_parameters: { message_id: q.message.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  });
}

export async function handleUpdate(u: TgUpdate, deps: GroupDeps): Promise<void> {
  try {
    if (u.poll) return await deps.updatePoll(u.poll);
    if (u.my_chat_member) {
      const c = u.my_chat_member.chat;
      return await deps.noteChat({
        id: String(c.id),
        title: c.title ?? "",
        type: c.type,
        status: u.my_chat_member.new_chat_member.status,
      });
    }
    if (u.callback_query) return await onCallback(u.callback_query, deps);
    const m = u.message;
    if (!m) return;
    if (m.chat.type === "private") {
      if (m.text && (await deps.linkOwner(m.chat.id, m.text, m.date))) return;
      if (m.text?.startsWith("/start")) {
        await deps.send("sendMessage", {
          chat_id: m.chat.id,
          text: "שלום! 👋 אני הבוט של מצאתי. כתבו מה אתם מחפשים בקבוצת החיפושים, ואחזיר את 5 המוצרים המתאימים ביותר שעברו את הסינון שלנו.",
        });
      }
      return;
    }
    // A group the bot never heard of (2026-10-27: Telegram's "added to a group" notice was lost
    // when the webhook was connected with drop_pending_updates): any message there records it, with
    // the bot's status, so the admin can pick it.
    if (
      (m.chat.type === "group" || m.chat.type === "supergroup") &&
      !(await deps.knownChat(String(m.chat.id)))
    ) {
      await deps.noteChat({
        id: String(m.chat.id),
        title: m.chat.title ?? "",
        type: m.chat.type,
        status: (await deps.chatStatus(m.chat.id)) ?? "member",
      });
    }
    const searchChat = await deps.searchChatId();
    if (searchChat && String(m.chat.id) === searchChat) await onGroupMessage(m, deps);
  } catch (err) {
    deps.log("telegram_update", err);
  }
}

/** The coupons as Telegram HTML (the owner's coupons valid now). */
export function couponsHtml(
  coupons: { code: string; title: string; min_spend_ils: number | null; ends_at: string | null }[],
  pageUrl: string,
): string | null {
  if (!coupons.length) return null;
  const lines = coupons.slice(0, 8).map((c) => {
    const parts = [`🎟️ <code>${escapeHtml(c.code)}</code> · ${escapeHtml(c.title)}`];
    if (c.min_spend_ils) parts.push(`בהזמנה מעל ₪${c.min_spend_ils}`);
    if (c.ends_at) {
      const d = new Date(c.ends_at);
      parts.push(
        `עד ${d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" })}`,
      );
    }
    return parts.join(" · ");
  });
  return [
    "<b>קופונים שבתוקף עכשיו</b> (לפי תנאי הקופון):",
    ...lines,
    `\nכל הקופונים: ${escapeHtml(pageUrl)}`,
  ].join("\n");
}
