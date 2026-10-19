import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { formatCount } from "@/lib/format";
import { formatShare } from "@/lib/stats/format";
import { orderStatusLabel, summarizeRevenue } from "@/lib/revenue/report";
import { loadRevenue, REVENUE_DAYS } from "@/lib/revenue/queries";
import { DataTable, Section, Td, Th } from "../stats/ui";

export const metadata: Metadata = {
  title: "הכנסות", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className={`${card} space-y-2 p-5`}>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="text-3xl leading-none font-bold">{value}</p>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}

export default async function RevenuePage() {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  const { orders, clicks, titles } = await loadRevenue();
  const summary = orders && summarizeRevenue(orders, clicks?.days30 ?? 0);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">הכנסות</h1>
        <p className="text-muted">
          ההזמנות והעמלות מהקישורים שלנו, לפי אלי אקספרס, ב־{REVENUE_DAYS} הימים האחרונים (לפי מועד
          התשלום), והקליקים לאלי אקספרס שספרנו באתר. נתוני ההזמנות מתעדכנים פעם בשעה.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="כניסות לאלי אקספרס דרך הקישורים שלנו"
          value={clicks ? <bdi dir="ltr">{formatCount(clicks.days30)}</bdi> : "לא זמין"}
          note={
            clicks && (
              <>
                מהם <bdi dir="ltr">{formatCount(clicks.days7)}</bdi> בשבוע האחרון
              </>
            )
          }
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
                    <bdi key={t.currency} dir="ltr" className="block">
                      {money(t.commission, t.currency)}
                    </bdi>
                  ))
                : money(0, "USD")
              : "לא זמין"
          }
          note={
            summary?.totals.length
              ? summary.totals.map((t) => (
                  <span key={t.currency} className="block">
                    מכירות: <bdi dir="ltr">{money(t.sales, t.currency)}</bdi>, אושר לתשלום:{" "}
                    <bdi dir="ltr">{money(t.settled, t.currency)}</bdi>
                  </span>
                ))
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
        description="כל מוצר בהזמנה בשורה משלו, החדשות קודם. הזמנה מופיעה בדרך כלל כמה שעות אחרי התשלום."
      >
        {!orders ? (
          <p className={`${card} p-5 text-muted`}>
            לא הצלחנו לקרוא את ההזמנות מאלי אקספרס כרגע. נסו לרענן בעוד כמה דקות.
          </p>
        ) : !orders.length ? (
          <p className={`${card} p-5 leading-relaxed text-muted`}>
            אלי אקספרס לא מדווחת על הזמנות מהקישורים שלנו ב־{REVENUE_DAYS} הימים האחרונים. אם בפורטל
            השותפים מופיעות הזמנות, כדאי לבדוק שם שה־Tracking ID שלהן הוא של האתר.
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
            {orders.slice(0, 100).map((o) => {
              const title = (o.productId && titles[o.productId]) || o.productTitle || o.productId;
              const currency = o.currency ?? "USD";
              const commission = o.finishedCommission ?? o.estimatedCommission;
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
                  </Td>
                  <Td numeric>
                    <bdi dir="ltr">{commission === null ? "-" : money(commission, currency)}</bdi>
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
        <p>
          <strong className="text-ink">על הנתונים:</strong> אלי אקספרס לא מספקת דרך ה־API נתוני
          צפיות או קליקים על הקישורים, לכן הכניסות נספרות אצלנו: כל לחיצה של גולש על ״לקנייה״ או על
          קישור לביקורות שעוברת דרך הקישור שלנו. בוטים לא נשלחים לאלי אקספרס ולא נספרים
          מ־19.10.2026. ב־17–18.10 נספרו כ־420 כניסות של בוט, לפני החסימה.
        </p>
        <p>
          העמלה היא הערכה של אלי אקספרס עד שההזמנה מאושרת (״אושר לתשלום עמלה״). התשלום נעשה פעם
          בחודש על החודש הקודם, והזמנות שבוטלו או הוחזרו לא מזכות בעמלה. הנתונים הסופיים בפורטל
          השותפים של אלי אקספרס.
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
