// The sitewide coupon a product's Telegram post names (owner request 2026-11-02): when the product has
// no coupon of its own, the general coupons are tiers by order amount ("US$12 הנחה בהזמנה מעל US$65",
// AliExpress's 11.11 codes), so the post names the one whose minimum the product's price meets and
// that takes the most off. Dollar tiers are compared in shekels at the day's rate, with a margin, and
// the final price is then approximate. Pure, tested.
import type { Coupon } from "./types";

/** Above a dollar minimum by this much at least, so the rate and the checkout's rounding never miss it. */
export const USD_MIN_MARGIN = 1.03;

/** "US$12 הנחה בהזמנה מעל US$65" (or "$12 ... $65"): the dollars off and the dollar minimum. */
export function usdTier(title: string): { offUsd: number; minUsd: number } | null {
  const m = /(?:US)?\$\s*(\d+(?:\.\d+)?)[^$\d]*?מעל\s*(?:US)?\$\s*(\d+(?:\.\d+)?)/i.exec(title);
  if (!m) return null;
  const offUsd = Number(m[1]);
  const minUsd = Number(m[2]);
  return offUsd > 0 && minUsd > offUsd ? { offUsd, minUsd } : null;
}

export interface SitewidePick {
  coupon: Coupon;
  /** Shekels off: the dollar amount at the day's rate (approx), or the owner's shekel amount. */
  offIls: number;
  /** True when converted from dollars: the post says "כ־" before the final price. */
  approx: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The sitewide coupon valid for a product of `priceIls`: of the coupons whose amount we can read (a
 * dollar tier, or a shekel amount in the title with its min_spend_ils) and whose minimum the price
 * meets, the one that takes the most off. `shekelAmount` reads an owner's shekel title
 * (ownerCouponAmount). Null when none applies.
 */
export function bestSitewideCoupon(
  coupons: readonly Coupon[],
  priceIls: number,
  usdIls: number,
  shekelAmount: (title: string) => { off_ils: number | null; off_pct: number | null },
): SitewidePick | null {
  let best: SitewidePick | null = null;
  for (const c of coupons) {
    if (c.scope !== "sitewide") continue;
    const tier = usdTier(c.title);
    let pick: SitewidePick | null = null;
    if (tier) {
      if (priceIls >= tier.minUsd * usdIls * USD_MIN_MARGIN)
        pick = { coupon: c, offIls: round2(tier.offUsd * usdIls), approx: true };
    } else {
      const { off_ils, off_pct } = shekelAmount(c.title);
      const off = off_ils ?? (off_pct !== null ? (priceIls * off_pct) / 100 : null);
      if (off !== null && off < priceIls && (c.min_spend_ils === null || priceIls >= c.min_spend_ils))
        pick = { coupon: c, offIls: round2(off), approx: false };
    }
    if (pick && (!best || pick.offIls > best.offIls)) best = pick;
  }
  return best;
}
