import { TicketPercent } from "lucide-react";
import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import { apiOfferParts } from "@/lib/coupons/display";
import { formatDateTime } from "@/lib/format";
import { CouponCodeRow } from "./coupon-card";

/**
 * Under the AliExpress code. COUPON_DISCLAIMER (community-coupon.tsx) speaks of community coupons,
 * so this one says the same about a code AliExpress attached to the product.
 */
export const API_CODE_DISCLAIMER =
  "הקוד ותנאיו נקבעים באלי אקספרס, וייתכן שייגמר לפני התאריך. בדקו בקופה באלי אקספרס שההנחה התקבלה לפני התשלום.";

/**
 * The code's offer, on /p and /coupons: "₪3.11 הנחה בהזמנה מעל ₪62.20" or "5% הנחה" from
 * AliExpress's own numbers, or AliExpress's own words when no known form matched or the offer is
 * in another currency (apiOfferParts). Renders nothing when there is nothing to say.
 */
export function ApiOffer({ promo }: { promo: AliPromoCode }) {
  const { off, minSpend, text } = apiOfferParts(promo);
  return (
    <>
      {(off || minSpend) && (
        <p className="leading-snug font-semibold text-ink">
          {off && (
            <>
              <bdi dir="ltr">{off}</bdi> הנחה
            </>
          )}
          {off && minSpend && " "}
          {minSpend && (
            <>
              בהזמנה מעל <bdi dir="ltr">{minSpend}</bdi>
            </>
          )}
        </p>
      )}
      {text && (
        <p className="text-sm">
          <span className="text-muted">כך אלי אקספרס מתארת את ההנחה: </span>
          <bdi dir="ltr" className="font-semibold break-words">
            {text}
          </bdi>
        </p>
      )}
    </>
  );
}

/** The product's promo code from AliExpress (promo_code_info), shown on /p while it is valid. */
export function ApiPromoCode({ code, checkedAt }: { code: AliPromoCode; checkedAt: string }) {
  return (
    <section
      aria-labelledby="ali-code-title"
      className="space-y-3 rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="ali-code-title"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-ink"
        >
          <TicketPercent aria-hidden className="size-3.5" />
          קוד הנחה של אלי אקספרס
        </h2>
        {/* <time>, not an LTR isolate: the Hebrew "בשעה" inside would be reordered. */}
        {code.endsAt && (
          <p className="text-sm text-muted">
            בתוקף עד <time dateTime={code.endsAt}>{formatDateTime(code.endsAt)}</time>
          </p>
        )}
      </div>
      <ApiOffer promo={code} />
      <CouponCodeRow code={code.code} className="rounded-2xl bg-surface-2 p-2 ps-3" />
      <p className="text-xs leading-relaxed text-muted">
        נבדק ב־<time dateTime={checkedAt}>{formatDateTime(checkedAt)}</time>. {API_CODE_DISCLAIMER}
      </p>
    </section>
  );
}
