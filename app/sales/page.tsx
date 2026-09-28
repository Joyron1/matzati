import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarClock, CloudOff, Search, TicketPercent } from "lucide-react";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { WhatsappCta } from "@/components/whatsapp-cta";
import { absoluteUrl, RESULTS_PER_PAGE } from "@/lib/config/site";
import { couponsForSale, hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasUpcomingSales, salesCalendar } from "@/lib/deals/queries";
import { SalesIntro, SalesView, type SalesData } from "./sales-view";

export async function generateMetadata(): Promise<Metadata> {
  // An empty calendar is not worth indexing; the sitemap leaves it out by the same rule.
  const hasSales = await hasUpcomingSales();
  return {
    title: "מבצעים גדולים",
    description:
      "מתי מתחילים המבצעים הגדולים באלי אקספרס: ספירה לאחור למבצע הבא, יומן ל־12 החודשים הקרובים והוספה ליומן שלכם.",
    alternates: { canonical: absoluteUrl("/sales") },
    ...(hasSales ? {} : { robots: { index: false, follow: true } }),
  };
}

async function loadSales(now: Date): Promise<SalesData | null> {
  try {
    const sales = await salesCalendar(now);
    // couponsForSale never throws: a failure shows the sale without its coupons.
    const coupons = await Promise.all(sales.map((sale) => couponsForSale(sale.id, now)));
    return { sales, coupons: new Map(sales.map((sale, i) => [sale.id, coupons[i]])) };
  } catch (err) {
    console.error(`[sales] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    return null;
  }
}

async function NoSales() {
  const hasCoupons = await hasPublishedCoupons();
  return (
    <StateCard Icon={CalendarClock} title="עוד אין מבצעים גדולים ביומן">
      <p className="max-w-md leading-relaxed text-muted">
        ברגע שאלי אקספרס תודיע על המבצע הגדול הבא, נוסיף אותו כאן עם ספירה לאחור.{" "}
        {hasCoupons
          ? `בינתיים אפשר לעבור על הקופונים והקודים לאלי אקספרס, או לכתוב בחיפוש מה אתם צריכים ולקבל ${RESULTS_PER_PAGE} מוצרים שעברו את הסינון.`
          : `בינתיים כתבו בחיפוש מה אתם צריכים, ונציג ${RESULTS_PER_PAGE} מוצרים שעברו את הסינון.`}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {hasCoupons && (
          <Link href="/coupons" className={`${btnPrimary} ${btnMd}`}>
            <TicketPercent aria-hidden className="size-[18px]" />
            לקופונים
          </Link>
        )}
        <Link href="/" className={`${hasCoupons ? btnSecondary : btnPrimary} ${btnMd}`}>
          <Search aria-hidden className="size-[18px]" />
          לחיפוש מוצר
        </Link>
      </div>
    </StateCard>
  );
}

export default async function SalesPage() {
  // Rendered per request: which sale is next, and the countdowns, depend on the time of the visit.
  await connection();
  const now = new Date();
  const data = await loadSales(now);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-8 sm:space-y-12 sm:px-6 sm:pt-12">
      <SalesIntro hasSales={data !== null && data.sales.length > 0} />
      {!data ? (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את המבצעים">
          <p className="max-w-md leading-relaxed text-muted">נסו לרענן את הדף בעוד רגע.</p>
        </StateCard>
      ) : data.sales.length === 0 ? (
        <NoSales />
      ) : (
        <SalesView data={data} now={now} />
      )}
      <WhatsappCta />
    </div>
  );
}
