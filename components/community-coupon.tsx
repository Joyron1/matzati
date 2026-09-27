import { TicketPercent } from "lucide-react";
import { formatShortDate } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { CopyButton } from "./copy-button";

export const COUPON_DISCLAIMER =
  "קופונים מהקהילה לא תמיד עובדים לכולם, וחלקם מוגבלים בזמן או בכמות. בדקו בקופה באלי אקספרס שההנחה התקבלה לפני התשלום.";

/** A community coupon from the deals table (admin-managed), shown on /p above the buy button. */
export function CommunityCoupon({ deal }: { deal: Deal }) {
  if (!deal.coupon_code) return null;
  return (
    <section
      aria-labelledby="coupon-title"
      className="space-y-3 rounded-card bg-gold-soft p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="coupon-title"
          className="inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-bold text-on-gold"
        >
          <TicketPercent aria-hidden className="size-3.5" />
          קופון מהקהילה
        </h2>
        {deal.ends_at && (
          <p className="text-sm text-muted">
            בתוקף עד <bdi dir="ltr">{formatShortDate(deal.ends_at)}</bdi>
          </p>
        )}
      </div>
      <p className="leading-snug font-semibold text-ink">{deal.title}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-2 ps-4">
        <p className="text-sm">
          קוד:{" "}
          <bdi dir="ltr" className="text-base font-bold tracking-wider">
            {deal.coupon_code}
          </bdi>
        </p>
        <CopyButton value={deal.coupon_code} label={`של הקוד ${deal.coupon_code}`} />
      </div>
      <p className="text-xs leading-relaxed text-muted">{COUPON_DISCLAIMER}</p>
    </section>
  );
}
