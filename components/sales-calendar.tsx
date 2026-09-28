import { buildSalesCalendar, spanLabel, type CalendarMonth } from "@/lib/deals/calendar";
import type { Deal } from "@/lib/types";
import { InPageLink } from "./in-page-link";
import { saleAnchor } from "./sale-card";
import { card } from "./styles";

const WEEKDAYS = [
  { short: "א׳", long: "ראשון" },
  { short: "ב׳", long: "שני" },
  { short: "ג׳", long: "שלישי" },
  { short: "ד׳", long: "רביעי" },
  { short: "ה׳", long: "חמישי" },
  { short: "ו׳", long: "שישי" },
  { short: "ש׳", long: "שבת" },
];

/** A month's sales, each linking to its card on the page: name and days ("11.11 עד 13.11"). */
function SaleLinks({
  sales,
  label,
  compact = false,
}: {
  sales: CalendarMonth["sales"];
  label?: string;
  compact?: boolean;
}) {
  return (
    <ul aria-label={label} className="space-y-2">
      {sales.map((sale) => (
        <li key={sale.id}>
          {/* Not a plain #anchor: that breaks Back after a later navigation (InPageLink). */}
          <InPageLink
            targetId={saleAnchor(sale.id)}
            className={`flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line hover:border-accent ${
              compact ? "bg-surface-2 px-3 py-2 text-sm" : "bg-surface px-4 py-2.5"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5 font-semibold text-ink">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-gold" />
              <span className="min-w-0 break-words">{sale.title}</span>
            </span>
            <span className="shrink-0 text-sm text-muted">{spanLabel(sale)}</span>
          </InPageLink>
        </li>
      ))}
    </ul>
  );
}

/** Phones and tablets: only the months that have a sale, as a list linking to each sale. */
function Agenda({ months }: { months: CalendarMonth[] }) {
  return (
    <ol className="space-y-5 lg:hidden">
      {months.map((month) => (
        <li key={month.key} className="space-y-2">
          <h3 className="font-bold text-ink">{month.label}</h3>
          <SaleLinks sales={month.sales} />
        </li>
      ))}
    </ol>
  );
}

/**
 * One month as a table, then the sales that touch it by name: a marigold day alone does not say
 * which sale it belongs to.
 */
function MonthGrid({ month }: { month: CalendarMonth }) {
  return (
    <div className={`${card} space-y-3 p-4`}>
      <table className="w-full table-fixed border-separate border-spacing-y-0.5 text-center text-sm">
        <caption className="pb-3 text-start font-bold text-ink">{month.label}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w.short} scope="col" className="pb-1 text-xs font-medium text-muted">
                <abbr title={w.long} className="no-underline">
                  {w.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => {
                if (!day) return <td key={j} />;
                const titles = day.sales.map((s) => s.title).join(", ");
                const tone =
                  day.sales.length > 0
                    ? "bg-gold font-bold text-on-gold"
                    : day.isPast
                      ? "text-muted"
                      : "text-ink";
                return (
                  <td key={day.key} aria-current={day.isToday ? "date" : undefined}>
                    <span
                      className={`mx-auto grid size-8 place-items-center rounded-full ${tone} ${
                        day.isToday ? "ring-2 ring-accent" : ""
                      }`}
                    >
                      {day.day}
                    </span>
                    {titles && <span className="sr-only">{`: ${titles}`}</span>}
                    {day.isToday && <span className="sr-only"> (היום)</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {month.sales.length > 0 && (
        <SaleLinks sales={month.sales} label={`המבצעים ב${month.label}`} compact />
      )}
    </div>
  );
}

/**
 * The next 12 months of sales in Israel time: an agenda of the months that have a sale on small
 * screens, the whole year as month grids from lg up, with sale days in marigold and today ringed.
 */
export function SalesCalendar({ sales, now }: { sales: Deal[]; now: Date }) {
  const months = buildSalesCalendar(sales, now);
  return (
    <section aria-labelledby="sales-calendar-title" className="space-y-5">
      <div className="space-y-1">
        <h2 id="sales-calendar-title" className="font-display text-3xl">
          יומן המבצעים
        </h2>
        <p className="text-muted">12 החודשים הקרובים, לפי שעון ישראל.</p>
      </div>
      <Agenda months={months.filter((m) => m.sales.length > 0)} />
      <div className="hidden space-y-4 lg:block">
        <ul aria-label="מקרא" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <li className="flex items-center gap-2">
            <span aria-hidden className="size-4 rounded-full bg-gold" />
            יום מבצע
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="size-4 rounded-full ring-2 ring-accent" />
            היום
          </li>
        </ul>
        <div className="grid grid-cols-3 gap-4">
          {months.map((month) => (
            <MonthGrid key={month.key} month={month} />
          ))}
        </div>
      </div>
    </section>
  );
}
