import Link from "next/link";
import { CalendarPlus, ChevronLeft } from "lucide-react";
import { SALE_CODE_NOTE } from "@/lib/copy";
import type { Coupon } from "@/lib/coupons/types";
import { formatDateTime } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { CouponCard, CouponCodeRow } from "./coupon-card";
import { SaleTimer } from "./sale-countdown";
import { btnMd, btnSecondary, card } from "./styles";

/** The sale's calendar file ("הוספה ליומן", app/sales/[id]/ics/route.ts). */
export const saleCalendarHref = (id: string) => `/sales/${id}/ics`;

/** Anchor of a sale on /sales; the calendar agenda links to it. */
export const saleAnchor = (id: string) => `sale-${id}`;

interface SaleDetailsProps {
  sale: Deal;
  /** Owner coupons linked to this sale (couponsForSale). */
  coupons: Coupon[];
  now: Date;
  /** In the hero countdown (gold, under an h2) or in a card (surface, under an h3). */
  placement: "hero" | "card";
}

/**
 * What the admin wrote for a sale: its description, its own coupon code, the coupons linked to it
 * and its product. Under the hero countdown and in each card on /sales; null when there is none.
 */
export function SaleDetails({ sale, coupons, now, placement }: SaleDetailsProps) {
  const hero = placement === "hero";
  if (!sale.body && !sale.coupon_code && coupons.length === 0 && !sale.product_id) return null;
  const couponsLabel = `${saleAnchor(sale.id)}-coupons`;
  return (
    <div className="space-y-4">
      {sale.body && <p className="leading-relaxed whitespace-pre-line text-muted">{sale.body}</p>}
      {sale.coupon_code && (
        // The code the admin added to the sale, styled like the linked coupons below it.
        <div className={`space-y-2 rounded-card p-3 ${hero ? "bg-surface" : "bg-gold-soft"}`}>
          <p className="text-sm font-bold text-ink">קוד למבצע</p>
          <CouponCodeRow
            code={sale.coupon_code}
            className={`rounded-2xl p-2 ps-3 ${hero ? "bg-gold-soft" : "bg-surface"}`}
          />
          <p className="text-xs leading-relaxed text-muted">{SALE_CODE_NOTE}</p>
        </div>
      )}
      {coupons.length > 0 && (
        // On the gold hero the (gold) coupon cards sit on a surface panel so their edges show.
        <div className={`space-y-2 ${hero ? "rounded-card bg-surface p-3" : ""}`}>
          <p id={couponsLabel} className="text-sm font-bold text-ink">
            קופונים למבצע
          </p>
          {/* Coupon titles are headings one level under the sale's title. A product coupon links
              to its product, so it is clear which product the code is for. */}
          <ul aria-labelledby={couponsLabel} className="space-y-2">
            {coupons.map((coupon) => (
              <li key={coupon.id}>
                <CouponCard
                  coupon={coupon}
                  now={now}
                  compact
                  headingLevel={hero ? 3 : 4}
                  showLink={coupon.scope === "product"}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {sale.product_id && (
        <Link
          href={`/p/${sale.product_id}`}
          className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-ink underline-offset-4 hover:underline"
        >
          לפרטי המוצר
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      )}
    </div>
  );
}

/**
 * "הוספה ליומן": the sale as a calendar event. No `download`: the file is served inline, so a
 * phone offers to add the event instead of saving a file.
 */
export function CalendarLink({ saleId }: { saleId: string }) {
  return (
    <a
      href={saleCalendarHref(saleId)}
      rel="nofollow"
      className={`${btnSecondary} ${btnMd} self-start`}
    >
      <CalendarPlus aria-hidden className="size-[18px]" />
      הוספה ליומן
    </a>
  );
}

/** One upcoming sale on /sales: a small countdown, its dates, details and "הוספה ליומן". */
export function SaleCard({ sale, coupons, now }: Omit<SaleDetailsProps, "placement">) {
  const titleId = `${saleAnchor(sale.id)}-title`;
  return (
    <article
      id={saleAnchor(sale.id)}
      aria-labelledby={titleId}
      className={`${card} flex scroll-mt-6 flex-col gap-4 p-5`}
    >
      {sale.starts_at && (
        <SaleTimer startsAt={sale.starts_at} endsAt={sale.ends_at} renderedAt={now.getTime()} />
      )}
      <div className="space-y-1">
        <h3 id={titleId} className="text-lg leading-snug font-bold">
          {sale.title}
        </h3>
        {/* Israel time, like every date on the site; the page says so above. */}
        {sale.starts_at && (
          <p className="text-sm text-muted">
            מ־<time dateTime={sale.starts_at}>{formatDateTime(sale.starts_at)}</time>
            {sale.ends_at && (
              <>
                {" "}
                עד <time dateTime={sale.ends_at}>{formatDateTime(sale.ends_at)}</time>
              </>
            )}
          </p>
        )}
      </div>
      <SaleDetails sale={sale} coupons={coupons} now={now} placement="card" />
      <CalendarLink saleId={sale.id} />
    </article>
  );
}
