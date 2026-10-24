// Posting an approved product to the Telegram channel (owner request 2026-10-19) through the Bot
// API (sendPhoto). Off until the owner sets TELEGRAM_BOT_TOKEN (from @BotFather) and
// TELEGRAM_CHAT_ID (the channel, "@name" or its -100… id; the bot must be an admin of it) in
// Vercel; they set them, never in chat. The token is never logged or put in an error message.
import { withBuyLink } from "@/lib/agents/finder/write";
import { absoluteUrl } from "@/lib/config/site";

export interface TelegramConfig {
  token: string;
  chatId: string;
}

/** The channel to post to, or null while either variable is unset. */
export function telegramConfig(source: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = source.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = source.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

/** Said under every post (the affiliate disclosure, as beside every buy button on the site). */
export const TELEGRAM_DISCLOSURE = "קישור שותפים: ייתכן שנקבל עמלה מרכישה, בלי עלות נוספת לכם.";

/** Telegram's limit for a photo caption. */
export const CAPTION_MAX = 1024;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The caption: the post, then the disclosure in italics, cut to Telegram's limit. */
export function captionOf(postHe: string): string {
  const tail = `\n\n<i>${escapeHtml(TELEGRAM_DISCLOSURE)}</i>`;
  const room = CAPTION_MAX - tail.length;
  let body = escapeHtml(postHe.trim());
  if (body.length > room) body = `${body.slice(0, room - 1).trimEnd()}…`;
  return `${body}${tail}`;
}

/** The post's buttons: buy through /go (src=telegram, counted as a click) and our product page. */
export function buttonsOf(productId: string) {
  const id = encodeURIComponent(productId);
  return {
    inline_keyboard: [
      [{ text: "לקנייה באלי אקספרס", url: absoluteUrl(`/go/${id}?src=telegram`) }],
      [{ text: "פרטים במצאתי", url: absoluteUrl(`/p/${id}`) }],
    ],
  };
}

export type TelegramResult = { ok: true; messageId: string } | { ok: false; error: string };

/**
 * Posts one product: the owner's video when there is one (sendVideo, a URL Telegram fetches, up
 * to 20 MB), else its photo (sendPhoto). Never throws: a failure comes back as its reason (no
 * secret in it).
 */
export async function postProduct(
  config: TelegramConfig,
  post: { productId: string; postHe: string; photoUrl: string; videoUrl?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramResult> {
  const media = post.videoUrl
    ? { method: "sendVideo", field: { video: post.videoUrl, supports_streaming: true } }
    : { method: "sendPhoto", field: { photo: post.photoUrl } };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${config.token}/${media.method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        ...media.field,
        caption: captionOf(
          withBuyLink(
            post.postHe,
            absoluteUrl(`/go/${encodeURIComponent(post.productId)}?src=telegram`),
          ),
        ),
        parse_mode: "HTML",
        reply_markup: buttonsOf(post.productId),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    } | null;
    if (res.ok && body?.ok && body.result?.message_id !== undefined) {
      return { ok: true, messageId: String(body.result.message_id) };
    }
    return {
      ok: false,
      error: `Telegram ${res.status}: ${body?.description ?? "no answer"}`.slice(0, 300),
    };
  } catch (err) {
    // A network error's message never holds the URL with the token, but keep only its name.
    return { ok: false, error: err instanceof Error ? err.name : "network error" };
  }
}
