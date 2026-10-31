// The coupons post for the Telegram channel (owner request 2026-11-01): the admin's button on
// /coupons sends every sitewide coupon valid now, each code in <code> (a tap copies it in
// Telegram), when they end, the affiliate link to AliExpress and the disclosure. Pure, tested.
import { formatDateTime } from "@/lib/format";
import { escapeHtml, TELEGRAM_DISCLOSURE } from "@/lib/telegram/client";
import { couponTiming, minSpendText } from "./display";
import type { Coupon } from "./types";

/** Telegram's limit for a message's text. */
export const MESSAGE_MAX = 4096;

const attr = (url: string) => escapeHtml(url).replace(/"/g, "&quot;");

/** The sitewide coupons valid at `now`, smallest minimum first (then by the title's first number). */
export function couponsForPost(coupons: Coupon[], now: Date): Coupon[] {
  const firstNumber = (title: string) => Number(/\d+(?:\.\d+)?/.exec(title)?.[0] ?? Infinity);
  return coupons
    .filter((c) => c.scope === "sitewide")
    .filter((c) => {
      const t = couponTiming(c, now);
      return t.state === "ending" || t.state === "open";
    })
    .sort(
      (a, b) =>
        (a.min_spend_ils ?? 0) - (b.min_spend_ils ?? 0) ||
        firstNumber(a.title) - firstNumber(b.title),
    );
}

export interface CouponsPostLinks {
  /** Our affiliate link to AliExpress's home page. */
  buyUrl: string;
  /** Our /coupons page, absolute. */
  pageUrl: string;
}

/**
 * The message (Telegram HTML). One end date shared by every coupon goes in the heading block;
 * otherwise each line says its own. Null when there is no coupon to post; the caller checks the
 * length against MESSAGE_MAX.
 */
export function couponsMessage(coupons: Coupon[], links: CouponsPostLinks): string | null {
  if (coupons.length === 0) return null;
  const ends = [...new Set(coupons.map((c) => c.ends_at))];
  const sharedEnd = ends.length === 1 ? ends[0] : undefined;
  const until = (iso: string) => `בתוקף עד ${formatDateTime(iso)}`;

  const lines = coupons.map((c) => {
    const min = minSpendText(c.min_spend_ils);
    const extra = [
      min,
      sharedEnd === undefined && c.ends_at ? `עד ${formatDateTime(c.ends_at)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `🔹 <code>${escapeHtml(c.code)}</code>: ${escapeHtml(c.title)}${extra ? ` (${escapeHtml(extra)})` : ""}`;
  });

  const parts = [
    "🎟️ <b>קופונים לאלי אקספרס שאפשר להשתמש בהם עכשיו</b>",
    ...(sharedEnd ? [`⏰ ${until(sharedEnd)}, או עד שהקודים ייגמרו`] : []),
    "",
    ...lines,
    "",
    "📋 לוחצים על הקוד כדי להעתיק אותו, ומדביקים בקופה באלי אקספרס בשדה של קוד הקופון. קוד אחד לכל הזמנה.",
    "",
    `🔗 <a href="${attr(links.buyUrl)}">לקנייה באלי אקספרס ←</a>`,
    `📄 <a href="${attr(links.pageUrl)}">כל הקופונים והתנאים באתר</a>`,
    "",
    `<i>${escapeHtml(TELEGRAM_DISCLOSURE)}</i>`,
  ];
  return parts.join("\n");
}

/** The message as plain text, for the admin's preview before sending. */
export function plainPreview(html: string): string {
  return html
    .replace(/<a href="[^"]*">([^<]*)<\/a>/g, "$1")
    .replace(/<\/?(b|i|code)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
