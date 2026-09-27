// How a coupon's dates and minimum read on a card, and how an AliExpress promo code's offer reads
// on /p and /coupons. Pure: the card passes the time of the render, so the server HTML is final and
// nothing depends on the visitor's clock.
import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import { formatIls, formatPct, timeUntil } from "@/lib/format";
import type { Coupon } from "./types";

/** Under every owner coupon: the terms are the coupon's, and the code goes in at AliExpress. */
export const OWNER_COUPON_NOTE =
  "קופון שהוספנו. ההנחה לפי תנאי הקופון, והקוד מוזן בקופה של אלי אקספרס.";

export type CouponTiming =
  | { state: "upcoming"; startsAt: string }
  | { state: "ending"; endsAt: string; left: string }
  | { state: "open" }
  | { state: "ended" };

/** Whether the coupon starts later, runs until a date, runs with no end date, or has ended. */
export function couponTiming(
  coupon: Pick<Coupon, "starts_at" | "ends_at">,
  now: Date,
): CouponTiming {
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now.getTime()) {
    return { state: "upcoming", startsAt: coupon.starts_at };
  }
  if (!coupon.ends_at) return { state: "open" };
  const left = timeUntil(new Date(coupon.ends_at), now);
  if (!left) return { state: "ended" };
  return { state: "ending", endsAt: coupon.ends_at, left: formatTimeLeft(left) };
}

/**
 * The largest whole unit left, for "נגמר בעוד ...": "3 ימים", "יומיים", "יום", "5 שעות",
 * "שעתיים", "שעה", "12 דקות", "דקה", "פחות מדקה".
 */
export function formatTimeLeft({
  days,
  hours,
  minutes,
}: {
  days: number;
  hours: number;
  minutes: number;
}): string {
  if (days > 0) return days === 1 ? "יום" : days === 2 ? "יומיים" : `${days} ימים`;
  if (hours > 0) return hours === 1 ? "שעה" : hours === 2 ? "שעתיים" : `${hours} שעות`;
  if (minutes > 0) return minutes === 1 ? "דקה" : `${minutes} דקות`;
  return "פחות מדקה";
}

/** "בהזמנה מעל ₪40"; null when there is no minimum. */
export function minSpendText(minSpendIls: number | null): string | null {
  if (minSpendIls === null || !(minSpendIls > 0)) return null;
  return `בהזמנה מעל ${formatIls(minSpendIls, false)}`;
}

/** An AliExpress promo code's offer, from AliExpress's own numbers and words. */
export interface ApiOfferParts {
  /** The discount, "₪3.11" or "5%"; null when there is none we can state. */
  off: string | null;
  /** The minimum order, "₪62.20"; null when there is none (0 is none) or we cannot state it. */
  minSpend: string | null;
  /**
   * code_value as AliExpress wrote it (English), when `off` is null because no pattern matched it
   * or it is in another currency. Shown as "כך אלי אקספרס מתארת את ההנחה"; null otherwise.
   */
  text: string | null;
}

const ilsAmount = (n: number | null) => (n !== null && n > 0 ? formatIls(n, false) : null);

/**
 * The offer as /p and /coupons show it. Codes are shown for ILS products only, and code_mini_spend
 * is in the request currency, so ₪ is what AliExpress itself wrote. An offer in another currency
 * states no amount at all (its minimum is surely in that currency too), and an offer text no
 * pattern matched is shown in AliExpress's words, which already hold its minimum; the minimum
 * alone is stated only when AliExpress sent no text.
 */
export function apiOfferParts(
  promo: Pick<AliPromoCode, "offer" | "offerText" | "minSpend">,
): ApiOfferParts {
  const { offer, offerText: text } = promo;
  if (!offer || (offer.currency !== null && offer.currency !== "ILS")) {
    return { off: null, minSpend: offer || text ? null : ilsAmount(promo.minSpend), text };
  }
  return {
    off: offer.kind === "amount" ? formatIls(offer.off, false) : formatPct(offer.pct),
    minSpend: ilsAmount(offer.minSpend ?? promo.minSpend),
    text: null,
  };
}

const israelClock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Jerusalem",
});

/** "2026-11-11T08:00:00Z" → "10:00" (Israel time). */
export function formatIsraelTime(iso: string): string {
  return israelClock.format(new Date(iso));
}

/** Null at Israel midnight (the date alone says it); otherwise the Israel time, e.g. "10:00". */
export function timeOfDay(iso: string): string | null {
  const time = formatIsraelTime(iso);
  return time === "00:00" ? null : time;
}
