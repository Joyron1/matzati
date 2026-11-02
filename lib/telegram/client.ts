// Posting an approved product to the Telegram channel (owner request 2026-10-19) through the Bot
// API (one photo or video with the post and its buttons; owner request 2026-11-02). Off until the owner sets TELEGRAM_BOT_TOKEN (from @BotFather) and
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

/** What the buy line says (its text is the link): short, Hebrew, so Telegram aligns it right. */
export const BUY_LINK_TEXT = "לקנייה באלי אקספרס ←";
const LINK_TOKEN = "⁣BUYLINK⁣";

/**
 * The caption: the post, then the disclosure in italics, cut to Telegram's limit. With `buyUrl`
 * (owner request 2026-10-27: a short link, aligned right), the post's 🔗 line becomes
 * "🔗 לקנייה באלי אקספרס ←" whose text is the link, instead of the whole URL.
 */
export function captionOf(postHe: string, buyUrl?: string): string {
  const tail = `\n\n<i>${escapeHtml(TELEGRAM_DISCLOSURE)}</i>`;
  // Room for the tags `emphasized` adds (two <b> lines and one <code>), so the HTML stays within it.
  const room = CAPTION_MAX - tail.length - 40;
  const text = buyUrl ? withBuyLink(postHe, LINK_TOKEN) : postHe;
  let body = escapeHtml(text.trim());
  if (body.length > room) body = `${body.slice(0, room - 1).trimEnd()}…`;
  body = emphasized(body);
  if (buyUrl) {
    body = body.replace(
      /🔗[^\n]*⁣BUYLINK⁣/,
      `🔗 <a href="${escapeHtml(buyUrl)}">${BUY_LINK_TEXT}</a>`,
    );
  }
  return `${body}${tail}`;
}

/**
 * The post's emphasis (owner request 2026-11-02, a reader should see the deal at a glance): the hook
 * line and the price line bold, each coupon code in <code> (a tap copies it). On escaped text.
 */
export function emphasized(escaped: string): string {
  let hook = false;
  return escaped
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (!hook) {
        hook = true;
        return `<b>${line}</b>`;
      }
      if (t.startsWith("💰")) return `<b>${line}</b>`;
      if (t.startsWith("🎟"))
        return line.replace(/(קוד קופון:?\s*)([A-Za-z0-9_-]{3,30})/, "$1<code>$2</code>");
      return line;
    })
    .join("\n");
}

/**
 * The post's buttons: buy at `buyUrl` (the
 * affiliate link, or /go with src=telegram when there is none) and our product page.
 */
export function buttonsOf(productId: string, buyUrl?: string) {
  const id = encodeURIComponent(productId);
  return {
    inline_keyboard: [
      [{ text: "לקנייה באלי אקספרס", url: buyUrl ?? absoluteUrl(`/go/${id}?src=telegram`) }],
      [{ text: "פרטים במצאתי", url: absoluteUrl(`/p/${id}`) }],
    ],
  };
}

export type TelegramResult = { ok: true; messageId: string } | { ok: false; error: string };

/** Telegram's limit of items in one album (sendMediaGroup). */
export const ALBUM_MAX = 10;

export interface ProductPost {
  productId: string;
  postHe: string;
  /**
   * Where the buy link goes (owner request 2026-10-25): the product's affiliate link straight to
   * AliExpress; /go only when the product has none.
   */
  buyUrl: string;
  /** Every photo of the product, the main one first. */
  photos: string[];
  /** The owner's video, when they uploaded one (it leads the post). */
  videos: string[];
}

/** The album's items: the videos, then the photos, once each, at most ALBUM_MAX. Pure, tested. */
export function albumItems(post: Pick<ProductPost, "photos" | "videos">): {
  type: "photo" | "video";
  media: string;
}[] {
  const seen = new Set<string>();
  const items: { type: "photo" | "video"; media: string }[] = [];
  for (const [type, list] of [
    ["video", post.videos],
    ["photo", post.photos],
  ] as const) {
    for (const url of list) {
      if (!url || seen.has(url) || items.length >= ALBUM_MAX) continue;
      seen.add(url);
      items.push({ type, media: url });
    }
  }
  return items;
}

async function call(
  config: TelegramConfig,
  method: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<TelegramResult> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, ...payload }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number } | { message_id?: number }[];
    } | null;
    const first = Array.isArray(body?.result) ? body.result[0] : body?.result;
    if (res.ok && body?.ok && first?.message_id !== undefined) {
      return { ok: true, messageId: String(first.message_id) };
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

/**
 * Posts one product as ONE message (owner request 2026-11-02: the photos never apart from the
 * post, and a buy button under it, which an album cannot carry): the owner's video, else the main
 * photo, with the post as its caption and the buttons; the buy link also on its 🔗 line. When
 * Telegram refuses the video (one it cannot fetch) the main photo goes instead. Never throws: a
 * failure comes back as its reason (no secret in it).
 */
export async function postProduct(
  config: TelegramConfig,
  post: ProductPost,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramResult> {
  const caption = captionOf(post.postHe, post.buyUrl);
  const items = albumItems(post);
  const photo = items.find((x) => x.type === "photo");
  const tries = [...new Set([items[0], photo])].filter((x) => !!x);
  let last: TelegramResult = { ok: false, error: "no photo or video" };
  for (const item of tries) {
    last = await call(
      config,
      item.type === "video" ? "sendVideo" : "sendPhoto",
      {
        [item.type]: item.media,
        ...(item.type === "video" ? { supports_streaming: true } : {}),
        caption,
        parse_mode: "HTML",
        reply_markup: buttonsOf(post.productId, post.buyUrl),
      },
      fetchImpl,
    );
    if (last.ok) return last;
  }
  return last;
}
