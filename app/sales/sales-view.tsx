import { SaleCard, SaleDetails, saleAnchor, saleCalendarHref } from "@/components/sale-card";
import { SaleCountdown } from "@/components/sale-countdown";
import { SalesCalendar } from "@/components/sales-calendar";
import { SALE_DATES_NOTE } from "@/lib/copy";
import type { Coupon } from "@/lib/coupons/types";
import { isCurrent } from "@/lib/deals/time";
import type { Deal } from "@/lib/types";

/**
 * The title and intro of /sales. With sales on the page it says where their dates come from once
 * for all of them (CLAUDE.md §1), so the cards below do not repeat it.
 */
export function SalesIntro({ hasSales }: { hasSales: boolean }) {
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="font-display text-4xl sm:text-5xl">מבצעים גדולים</h1>
      <p className="text-lg leading-relaxed text-muted">
        מתי מתחילים המבצעים הגדולים באלי אקספרס וכמה זמן נשאר עד שהם נגמרים. אפשר להוסיף כל מבצע
        ליומן שלכם בלחיצה.
      </p>
      {hasSales && (
        <p className="text-sm leading-relaxed text-muted">{SALE_DATES_NOTE} השעות בשעון ישראל.</p>
      )}
    </div>
  );
}

export interface SalesData {
  /** Earliest start first (salesCalendar); never empty here. */
  sales: Deal[];
  /** Coupons linked to each sale, by sale id. */
  coupons: Map<string, Coupon[]>;
}

/**
 * /sales with at least one sale: the hero countdown for the first one (running now if any sale
 * is), cards for the rest, then the 12-month calendar.
 */
export function SalesView({ data, now }: { data: SalesData; now: Date }) {
  const [featured, ...rest] = data.sales;
  const couponsOf = (sale: Deal) => data.coupons.get(sale.id) ?? [];
  return (
    <>
      <div
        className={
          rest.length > 0
            ? "grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6"
            : "max-w-3xl"
        }
      >
        <div id={saleAnchor(featured.id)} className="scroll-mt-6">
          <SaleCountdown
            title={featured.title}
            // salesCalendar only returns sales with a start.
            startsAt={featured.starts_at ?? ""}
            endsAt={featured.ends_at}
            renderedAt={now.getTime()}
            // The WhatsApp card is further down this page.
            reminderHref={null}
            calendarHref={saleCalendarHref(featured.id)}
            // The page intro already says where the dates come from.
            datesNote={false}
          >
            <SaleDetails sale={featured} coupons={couponsOf(featured)} now={now} placement="hero" />
          </SaleCountdown>
        </div>
        {rest.length > 0 && (
          <section aria-labelledby="soon-title" className="space-y-4">
            <h2 id="soon-title" className="font-display text-3xl">
              {rest.some((sale) => isCurrent(sale, now)) ? "עוד מבצעים" : "בקרוב"}
            </h2>
            <ul className="space-y-4">
              {rest.map((sale) => (
                <li key={sale.id}>
                  <SaleCard sale={sale} coupons={couponsOf(sale)} now={now} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <SalesCalendar sales={data.sales} now={now} />
    </>
  );
}
