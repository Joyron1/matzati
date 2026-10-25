// Posting an approved product to the Telegram channel (owner request 2026-10-19) through the Bot
// API (an album of every photo and video, sendMediaGroup; owner request 2026-10-25). Off until the owner sets TELEGRAM_BOT_TOKEN (from @BotFather) and
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

/**
 * The post's buttons (a single photo or video only: an album takes none): buy at `buyUrl` (the
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
  /** Every photo of the product, in AliExpress's order. */
  photos: string[];
  /** The owner's video first, then AliExpress's. */
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
 * Posts one product (owner request 2026-10-25: all its photos and videos, and the affiliate link
 * straight to AliExpress). With two or more items, one album (sendMediaGroup: Telegram fetches
 * each URL, a photo up to 5 MB and a video up to 20 MB) with the post as the first item's caption;
 * an album takes no buttons, so the buy link is the 🔗 line in the text. When Telegram refuses the
 * album (a video it cannot fetch, mostly) it is sent again with the photos only, and then as one
 * photo. A single item goes as before: sendPhoto or sendVideo with the buttons. Never throws: a
 * failure comes back as its reason (no secret in it).
 */
export async function postProduct(
  config: TelegramConfig,
  post: ProductPost,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramResult> {
  const caption = captionOf(withBuyLink(post.postHe, post.buyUrl));
  const items = albumItems(post);
  const album = (list: typeof items) =>
    call(
      config,
      "sendMediaGroup",
      {
        media: list.map((item, i) => (i === 0 ? { ...item, caption, parse_mode: "HTML" } : item)),
      },
      fetchImpl,
    );
  let first: TelegramResult | null = null;
  if (items.length >= 2) {
    first = await album(items);
    if (first.ok) return first;
    const photos = items.filter((x) => x.type === "photo");
    if (photos.length >= 2 && photos.length < items.length) {
      const again = await album(photos);
      if (again.ok) return again;
    }
  }
  const single = items.find((x) => x.type === "photo") ?? items[0];
  if (!single) return first ?? { ok: false, error: "no photo or video" };
  const sent = await call(
    config,
    single.type === "video" ? "sendVideo" : "sendPhoto",
    {
      [single.type]: single.media,
      ...(single.type === "video" ? { supports_streaming: true } : {}),
      caption,
      parse_mode: "HTML",
      reply_markup: buttonsOf(post.productId, post.buyUrl),
    },
    fetchImpl,
  );
  return sent.ok || !first ? sent : first;
}
