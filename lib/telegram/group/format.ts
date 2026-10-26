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

/**
 * The right-to-left mark (owner request 2026-10-27: lines that began with a number, Latin or a
 * price showed left to right). Telegram sets each line's direction by its first strong character;
 * this one starts every line, so every line reads right to left.
 */
export const RLM = "\u200F";
const rtl = (text: string) =>
  text
    .split("\n")
    .map((line) => (line ? `${RLM}${line}` : line))
    .join("\n");

export interface GroupProduct {
  product: ResultProduct;
  /** The affiliate link (or /go when the product has none). */
  link: string;
  /** A clean short name and a one-line description (describe.ts), when the model's held. */
  name?: string;
  line?: string | null;
}

/** The caption's visible length: its text without tags, entities counted as one character. */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&(lt|gt|amp|quot);/g, "_").length;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function block(
  g: GroupProduct,
  i: number,
  titleMax: number,
  withLine: boolean,
  now: number,
): string {
  const p = g.product;
  const name = g.name ?? clip(p.title_he || p.title_en, titleMax);
  const lines = [`${MEDALS[i]} <b>${escapeHtml(clip(name, titleMax))}</b>`];
  if (withLine && g.line) lines.push(escapeHtml(g.line));
  // The price first, then sales and feedback, on one line.
  const facts = [`💰 ${formatIls(p.price_ils, p.price_is_approx)}`];
  if (p.units_sold !== null) facts.push(`🛒 ${formatCount(p.units_sold)} בחודש`);
  if (p.positive_feedback_pct !== null) facts.push(`⭐ ${formatPct(p.positive_feedback_pct)}`);
  lines.push(facts.join(" · "));
  if (p.promo_code && promoCodeValid(p.promo_code, now)) {
    lines.push(`🎟️ קוד הנחה: <code>${escapeHtml(p.promo_code.code)}</code>`);
  }
  if (p.passed_tier === "loose") lines.push("⚠️ פחות מוכח: פחות מכירות או משוב מהסף הרגיל");
  lines.push(`🔗 <a href="${escapeHtml(g.link)}">לקנייה באלי אקספרס</a>`);
  return lines.join("\n");
}

export function groupCaption(query: string, items: GroupProduct[], now = Date.now()): string {
  const shown = items.slice(0, GROUP_RESULTS);
  const head = `🔍 <b>מצאתי ${shown.length === 1 ? "מוצר אחד" : `${shown.length} מוצרים`} עבור ״${escapeHtml(clip(query, 60))}״</b>`;
  const foot = "<i>🛒 = נמכרו ב־30 הימים האחרונים · ⭐ = משוב חיובי · קישורי שותפים</i>";
  for (const [titleMax, withLine] of [
    [45, true],
    [38, true],
    [45, false],
    [32, false],
    [24, false],
  ] as const) {
    const body = shown.map((g, i) => block(g, i, titleMax, withLine, now));
    const caption = rtl([head, ...body, foot].join("\n\n"));
    if (visibleLength(caption) <= CAPTION_LIMIT) return caption;
  }
  // Still too long (very long codes or numbers): one line per product.
  const body = shown.map(
    (g, i) =>
      `${MEDALS[i]} <a href="${escapeHtml(g.link)}">${escapeHtml(clip(g.name ?? (g.product.title_he || g.product.title_en), 28))}</a> · ${formatIls(g.product.price_ils, g.product.price_is_approx)}`,
  );
  return rtl([head, ...body, foot].join("\n\n"));
}

/** The short note while the bot searches (owner request 2026-10-27), deleted with the answer. */
export function searchingText(query: string): string {
  return rtl(
    `🔎 מחפש עבורכם ״${escapeHtml(clip(query, 60))}״…\nבודק מכירות, משוב והתאמה. זה לוקח כמה שניות.`,
  );
}

/** The note when nothing passed: what to try instead (the site's help, short). */
export function noResultsText(query: string): string {
  return rtl(
    `🔍 לא מצאנו מוצרים שעברו את הסינון שלנו עבור ״${escapeHtml(clip(query, 80))}״.\nנסו לנסח פשוט יותר (סוג המוצר ותכונה אחת), או לבדוק את החיפוש הרחב באתר.`,
  );
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
