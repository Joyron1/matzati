// The search group's answer (owner request 2026-10-25, after their example): a collage photo of the
// five products numbered 1-5, and this caption: the query, then per product its medal, Hebrew
// title, 30-day sales, positive feedback, price, AliExpress code while valid, "פחות מוכח" when it
// met only LOOSE_TIER, and the affiliate link straight to AliExpress. Telegram counts a caption's
// visible text (1024), not its HTML tags; titles are shortened until it fits. Pure, tested.
import { formatCount, formatIls, formatPct } from "@/lib/format";
import { promoCodeValid } from "@/lib/search/promo";
import type { ResultProduct } from "@/lib/types";
import { escapeHtml } from "../client";

export const CAPTION_LIMIT = 1024;
export const GROUP_RESULTS = 5;
export const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

export interface GroupProduct {
  product: ResultProduct;
  /** The affiliate link (or /go when the product has none). */
  link: string;
}

/** The caption's visible length: its text without tags, entities counted as one character. */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&(lt|gt|amp|quot);/g, "_").length;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function block(g: GroupProduct, i: number, titleMax: number, now: number): string {
  const p = g.product;
  const lines = [`${MEDALS[i]} <b>${escapeHtml(clip(p.title_he || p.title_en, titleMax))}</b>`];
  const trust = [
    p.units_sold !== null ? `🛒 ${formatCount(p.units_sold)} נמכרו בחודש` : null,
    p.positive_feedback_pct !== null ? `⭐ ${formatPct(p.positive_feedback_pct)} משוב` : null,
  ].filter(Boolean);
  if (trust.length) lines.push(trust.join(" · "));
  const price = [`💰 ${formatIls(p.price_ils, p.price_is_approx)}`];
  if (p.promo_code && promoCodeValid(p.promo_code, now)) {
    price.push(`🎟️ קוד: <code>${escapeHtml(p.promo_code.code)}</code>`);
  }
  lines.push(price.join(" · "));
  if (p.passed_tier === "loose") lines.push("⚠️ פחות מוכח: פחות מכירות או משוב מהסף הרגיל");
  lines.push(`🔗 <a href="${escapeHtml(g.link)}">לקנייה באלי אקספרס</a>`);
  return lines.join("\n");
}

export function groupCaption(query: string, items: GroupProduct[], now = Date.now()): string {
  const head = `🔍 <b>מצאתי עבור:</b> ״${escapeHtml(clip(query, 80))}״`;
  const foot = "<i>קישורי שותפים. המחירים באלי אקספרס עשויים להשתנות.</i>";
  for (const titleMax of [70, 55, 45, 35, 28, 22]) {
    const body = items.slice(0, GROUP_RESULTS).map((g, i) => block(g, i, titleMax, now));
    const caption = [head, ...body, foot].join("\n\n");
    if (visibleLength(caption) <= CAPTION_LIMIT) return caption;
  }
  // Still too long (very long codes or numbers): fewer lines per product.
  const body = items
    .slice(0, GROUP_RESULTS)
    .map(
      (g, i) =>
        `${MEDALS[i]} <a href="${escapeHtml(g.link)}">${escapeHtml(clip(g.product.title_he || g.product.title_en, 30))}</a> · ${formatIls(g.product.price_ils, g.product.price_is_approx)}`,
    );
  return [head, ...body, foot].join("\n\n");
}

/** The note when nothing passed: what to try instead (the site's help, short). */
export function noResultsText(query: string): string {
  return `🔍 לא מצאנו מוצרים שעברו את הסינון שלנו עבור ״${escapeHtml(clip(query, 80))}״.\nנסו לנסח פשוט יותר (סוג המוצר ותכונה אחת), או לבדוק את החיפוש הרחב באתר.`;
}

/** The buttons under an answer: the same search on the site, and the coupons. */
export function answerButtons(siteSearchUrl: string) {
  return {
    inline_keyboard: [
      [
        { text: "🔎 חיפוש רחב באתר", url: siteSearchUrl },
        { text: "🎟️ קופונים", callback_data: "coupons" },
      ],
    ],
  };
}
