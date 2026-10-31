import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { btnSecondary, btnSm, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { toIls } from "@/lib/fx/boi";
import { formatCount } from "@/lib/format";
import { formatIlsAmount, formatIsraelDay, formatShare } from "@/lib/stats/format";
import { orderStatusLabel, summarizeRevenue } from "@/lib/revenue/report";
import { loadRevenue, type OrdersError } from "@/lib/revenue/queries";
import {
  MAX_RANGE_DAYS,
  parseRange,
  rangeDays,
  rangeHref,
  rangePresets,
  type RevenueRange,
} from "@/lib/revenue/range";
import { inputClass } from "../settings/form-parts";
import { FxNote } from "../stats/sections";
import { DataTable, Section, Td, Th } from "../stats/ui";

export const metadata: Metadata = {
  title: "הכנסות", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

// Up to three order.list windows of 4 calls or more, spaced 1.1 s apart.
export const maxDuration = 60;

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** The amount in shekels with the day's rate ("≈ ₪9.27"), or null for a currency we do not convert. */
function shekels(amount: number, currency: string, rate: number): string | null {
  if (currency === "ILS") return null;
  const ils = toIls(amount, currency, rate);
  return ils ? `≈ ${formatIlsAmount(ils.ils)}` : null;
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className={`${card} space-y-2 p-5`}>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <div className="text-3xl leading-none font-bold">{value}</div>
      {note && <div className="text-sm text-muted">{note}</div>}
    </div>
  );
}

const ORDERS_ERROR_TEXT: Record<OrdersError, string> = {
  rate_limit: "אלי אקספרס ביקשה להאט (יותר מדי קריאות בבת אחת).",
  auth: "אלי אקספרס דחתה את פרטי החיבור של האתר.",
  network: "אלי אקספרס לא ענתה בזמן.",
  other: "אלי אקספרס החזירה תשובה שלא הצלחנו לקרוא.",
};

/** "27.10" or "1.10–29.10", the range as the headings say it. */
function rangeText(r: RevenueRange): string {
  const day = (d: string) => formatIsraelDay(d);
  return r.from === r.to ? day(r.from) : `${day(r.from)} – ${day(r.to)}`;
}

function RangeFilter({ range, now }: { range: RevenueRange; now: Date }) {
  const today = parseRange({}, now).to;
  return (
    <div className={`${card} space-y-4 p-5`}>
      <nav aria-label="טווחים מהירים" className="flex flex-wrap gap-2">
        {rangePresets(now).map((p) => {
          const current = p.range.from === range.from && p.range.to === range.to;
          return (
            <Link
              key={p.label}
              href={rangeHref(p.range)}
              aria-current={current ? "true" : undefined}
              className={`${btnSecondary} ${btnSm} aria-[current]:border-ink aria-[current]:font-bold`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      {/* A plain GET form: the range lives in the address, so it can be bookmarked or shared. */}
      <form method="get" action="/admin/revenue" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="revenue-from" className="text-sm font-semibold">
            מתאריך
          </label>
          <input
            id="revenue-from"
            type="date"
            name="from"
            dir="ltr"
            defaultValue={range.from}
            max={today}
            className={`${inputClass} w-44`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="revenue-to" className="text-sm font-semibold">
            עד תאריך
          </label>
          <input
            id="revenue-to"
            type="date"
            name="to"
            dir="ltr"
            defaultValue={range.to}
            max={today}
            className={`${inputClass} w-44`}
          />
        </div>
        <button type="submit" className={`${btnSecondary} ${btnSm}`}>
          הצגה
        </button>
      </form>
      <p className="text-sm text-muted">
        לפי מועד התשלום, שעון ישראל. עד {MAX_RANGE_DAYS} יום בכל פעם.
      </p>
    </div>
  );
}

export default async function RevenuePage({ searchParams }: PageProps<"/admin/revenue">) {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  const now = new Date();
  const range = parseRange(await searchParams, now);
  const { orders, ordersError, clicks, titles, fx } = await loadRevenue(range, now);
  const summary = orders && summarizeRevenue(orders, clicks ?? 0);
  const days = rangeDays(range);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">הכנסות</h1>
        <p className="text-muted">
          ההזמנות והעמלות מהקישורים שלנו, לפי אלי אקספרס, והקליקים לאלי אקספרס שספרנו באתר. נתוני
          ההזמנות מתעדכנים פעם בשעה.
        </p>
      </div>

      <RangeFilter range={range} now={now} />

      <p className="font-semibold">
        <bdi>{rangeText(range)}</bdi> ({days === 1 ? "יום אחד" : `${days} ימים`})
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="כניסות לאלי אקספרס דרך הקישורים שלנו"
          value={clicks === null ? "לא זמין" : <bdi dir="ltr">{formatCount(clicks)}</bdi>}
        />
        <Tile
          label="הזמנות"
          value={summary ? <bdi dir="ltr">{formatCount(summary.orders)}</bdi> : "לא זמין"}
          note={
            summary && (
              <>
                <bdi dir="ltr">{formatCount(summary.items)}</bdi> מוצרים
                {summary.invalid > 0 && (
                  <>
                    , ועוד <bdi dir="ltr">{formatCount(summary.invalid)}</bdi> שבוטלו
                  </>
                )}
              </>
            )
          }
        />
        <Tile
          label="עמלה משוערת"
          value={
            summary
              ? summary.totals.length
                ? summary.totals.map((t) => (
                    <span key={t.currency} className="block space-y-1">
                      <bdi dir="ltr" className="block">
                        {money(t.commission, t.currency)}
                      </bdi>
                      {shekels(t.commission, t.currency, fx.rate) && (
                        <bdi dir="ltr" className="block text-lg font-semibold text-muted">
                          {shekels(t.commission, t.currency, fx.rate)}
                        </bdi>
                      )}
                    </span>
                  ))
                : money(0, "USD")
              : "לא זמין"
          }
          note={
            summary?.totals.length
              ? summary.totals.map((t) => {
                  const salesIls = shekels(t.sales, t.currency, fx.rate);
                  const settledIls = shekels(t.settled, t.currency, fx.rate);
                  return (
                    <span key={t.currency} className="block">
                      מכירות: <bdi dir="ltr">{money(t.sales, t.currency)}</bdi>
                      {salesIls && (
                        <>
                          {" "}
                          (<bdi dir="ltr">{salesIls}</bdi>)
                        </>
                      )}
                      , אושר לתשלום: <bdi dir="ltr">{money(t.settled, t.currency)}</bdi>
                      {settledIls && t.settled > 0 && (
                        <>
                          {" "}
                          (<bdi dir="ltr">{settledIls}</bdi>)
                        </>
                      )}
                    </span>
                  );
                })
              : "הערכה של אלי אקספרס עד שההזמנה מאושרת"
          }
        />
        <Tile
          label="המרה"
          value={summary ? <bdi dir="ltr">{formatShare(summary.conversion)}</bdi> : "לא זמין"}
          note="הזמנות לכל כניסה לאלי אקספרס"
        />
      </div>

      <Section
        id="orders"
        title="הזמנות"
        description="כל מוצר בהזמנה בשורה משלו, החדשות קודם. הזמנה מופיעה בדרך כלל כמה שעות אחרי התשלום. שעת התשלום כפי שאלי אקספרס שולחת אותה, שעון החוף המערבי של ארה״ב."
      >
        {!orders ? (
          <div className={`${card} space-y-2 p-5 text-muted`}>
            <p>לא הצלחנו לקרוא את ההזמנות מאלי אקספרס כרגע.</p>
            {ordersError && <p>{ORDERS_ERROR_TEXT[ordersError]}</p>}
            <p>
              <Link href={rangeHref(range)} className="font-semibold text-accent-ink underline">
                לנסות שוב
              </Link>{" "}
              (תקלה לא נשמרת, כל טעינה שואלת מחדש).
            </p>
          </div>
        ) : !orders.length ? (
          <p className={`${card} p-5 leading-relaxed text-muted`}>
            אלי אקספרס לא מדווחת על הזמנות מהקישורים שלנו בטווח הזה. אם בפורטל השותפים מופיעות
            הזמנות, כדאי לבדוק שם שה־Tracking ID שלהן הוא של האתר.
          </p>
        ) : (
          <DataTable
            labelledBy="orders"
            caption="הזמנות מהקישורים שלנו"
            head={
              <>
                <Th>תאריך תשלום</Th>
                <Th>מוצר</Th>
                <Th>סטטוס</Th>
                <Th numeric>כמות</Th>
                <Th numeric>סכום</Th>
                <Th numeric>עמלה משוערת</Th>
              </>
            }
          >
            {orders.slice(0, 250).map((o) => {
              const title = (o.productId && titles[o.productId]) || o.productTitle || o.productId;
              const currency = o.currency ?? "USD";
              const commission = o.finishedCommission ?? o.estimatedCommission;
              const paidIls =
                o.paidAmount === null ? null : shekels(o.paidAmount, currency, fx.rate);
              const commissionIls =
                commission === null ? null : shekels(commission, currency, fx.rate);
              return (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <Td>
                    <bdi dir="ltr">{o.paidTime ?? "-"}</bdi>
                  </Td>
                  <Td wrap>
                    {o.productId ? (
                      <Link
                        href={`/p/${encodeURIComponent(o.productId)}`}
                        className="line-clamp-2 max-w-sm underline underline-offset-4"
                      >
                        {title}
                      </Link>
                    ) : (
                      (title ?? "-")
                    )}
                  </Td>
                  <Td>{orderStatusLabel(o.status)}</Td>
                  <Td numeric>{o.productCount ?? "-"}</Td>
                  <Td numeric>
                    <bdi dir="ltr">
                      {o.paidAmount === null ? "-" : money(o.paidAmount, currency)}
                    </bdi>
                    {paidIls && (
                      <span className="block text-xs text-muted">
                        <bdi dir="ltr">{paidIls}</bdi>
                      </span>
                    )}
                  </Td>
                  <Td numeric>
                    <bdi dir="ltr">{commission === null ? "-" : money(commission, currency)}</bdi>
                    {commissionIls && (
                      <span className="block text-xs text-muted">
                        <bdi dir="ltr">{commissionIls}</bdi>
                      </span>
                    )}
                    {o.commissionRatePct !== null && (
                      <span className="block text-xs text-muted">
                        <bdi dir="ltr">{o.commissionRatePct}%</bdi>
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Section>

      <div className={`${card} space-y-2 p-5 text-sm leading-relaxed text-muted`}>
        <FxNote fx={fx} />
        <p>
          <strong className="text-ink">על הנתונים:</strong> אלי אקספרס לא מספקת דרך ה־API נתוני
          צפיות או קליקים על הקישורים, לכן הכניסות נספרות אצלנו: כל לחיצה של גולש על ״לקנייה״ או על
          קישור לביקורות שעוברת דרך הקישור שלנו. בוטים לא נשלחים לאלי אקספרס ולא נספרים
          מ־19.10.2026. ב־17–18.10 נספרו כ־420 כניסות של בוט, לפני החסימה.
        </p>
        <p>
          העמלה היא הערכה של אלי אקספרס עד שההזמנה מאושרת (״אושר לתשלום עמלה״). התשלום נעשה פעם
          בחודש על החודש הקודם, בדולרים, והזמנות שבוטלו או הוחזרו לא מזכות בעמלה. הסכום בשקלים הוא
          לפי השער של היום, לא של יום התשלום. הנתונים הסופיים בפורטל השותפים של אלי אקספרס.
        </p>
        <p>
          לנתוני חיפושים, קליקים לפי מוצר ועלויות:{" "}
          <Link href="/admin/stats" className="font-semibold text-accent-ink underline">
            נתונים
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
