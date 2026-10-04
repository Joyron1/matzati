import { ShieldQuestion, TicketPercent } from "lucide-react";
import { LOOSE_TIER } from "@/lib/ranking/config";
import type { ResultProduct } from "@/lib/types";

type BadgeFields = Pick<ResultProduct, "passed_tier" | "promo_code_valid">;

/** "פחות מוכח" in words, for the card's accessible text and the results page legend. */
export const LESS_PROVEN_LABEL = "פחות מוכח";
export const LESS_PROVEN_NOTE = `מתאים בדיוק לחיפוש, אבל עם פחות מכירות או משוב נמוך יותר מהסף הרגיל שלנו (לפחות ${LOOSE_TIER.minPositiveFeedbackPct}% משוב חיובי ו־${LOOSE_TIER.minUnitsSold} מכירות ב־30 הימים האחרונים).`;

/**
 * Small badges on a result card (owner request 2026-10-04): "פחות מוכח" for a product that meets
 * only LOOSE_TIER, and "קוד הנחה" while its AliExpress promo code is valid (promo_code_valid, set
 * by the server when it sends the results: withPromoValidity; the code itself is on its product
 * page). The discount is the price's own badge (components/price.tsx). Free shipping
 * is never claimed: the affiliate API returns no shipping data. Renders nothing without a badge.
 */
export function CardBadges({ product }: { product: BadgeFields }) {
  const loose = product.passed_tier === "loose";
  const code = product.promo_code_valid === true;
  if (!loose && !code) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs font-semibold">
      {loose && (
        <li
          title={LESS_PROVEN_NOTE}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-muted"
        >
          <ShieldQuestion aria-hidden className="size-3.5" />
          {LESS_PROVEN_LABEL}
          <span className="sr-only">: {LESS_PROVEN_NOTE}</span>
        </li>
      )}
      {code && (
        <li className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-accent-ink">
          <TicketPercent aria-hidden className="size-3.5" />
          קוד הנחה<span className="sr-only"> של אלי אקספרס</span>
        </li>
      )}
    </ul>
  );
}
