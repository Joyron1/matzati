// The parts of /admin/stats. Every number comes from our own tables (lib/stats/queries.ts); a part
// that could not be loaded says so instead of showing zeros.
import Link from "next/link";
import type { ReactNode } from "react";
import { FilePlus2 } from "lucide-react";
import { btnSecondary, card } from "@/components/styles";
import type { UsdIlsRate } from "@/lib/fx/boi";
import { formatCount, formatDateTime } from "@/lib/format";
import {
  formatIlsAmount,
  formatIsraelDay,
  formatShare,
  formatUsd,
  llmKindLabel,
  NO_SHARE,
} from "@/lib/stats/format";
import {
  budgetUse,
  ratio,
  sumDaily,
  usdToIls,
  type DailyStats,
  type LlmKindStats,
  type TopProduct,
  type TopQuery,
  type ZeroResultQuery,
} from "@/lib/stats/report";
import { DataTable, LOAD_FAILED, Notice, Row, RowTh, Section, Td, Th } from "./ui";

const ils = (usd: number, fx: UsdIlsRate) => `≈${formatIlsAmount(usdToIls(usd, fx.rate))}`;

// --- Today --------------------------------------------------------------------------------------

// Counts are written as "label: number", so the Hebrew never has to agree with the number.

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`${card} space-y-2 p-5`}>
      <p className="text-sm font-semibold text-muted">{label}</p>
      {/* Numbers use the body font (design system: Plex for UI and numbers), as in SaleCountdown. */}
      <p className="text-3xl leading-none font-bold">{value}</p>
      {children && <div className="space-y-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

function BudgetTile({ counter, cap }: { counter: number | null; cap: number | null }) {
  if (counter === null || cap === null) {
    return (
      <Tile label="תקציב LLM היום" value="לא זמין">
        {cap === null ? (
          <p>
            לא הצלחנו לקרוא את <bdi dir="ltr">DAILY_SEARCH_CAP</bdi>.
          </p>
        ) : (
          <p>לא הצלחנו לקרוא את המונה של היום.</p>
        )}
      </Tile>
    );
  }
  const b = budgetUse(counter, cap);
  const pct = Math.round(b.share * 100);
  return (
    <Tile
      label="תקציב LLM היום"
      value={
        <>
          {formatCount(b.used)}{" "}
          <span className="text-base font-normal text-muted">מתוך {formatCount(b.cap)}</span>
        </>
      }
    >
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {b.cap === 0 ? (
        <p>התקציב היומי הוא 0: עבודה חדשה של ה־LLM כבויה, תוצאות מהמטמון עדיין מוצגות.</p>
      ) : b.refused > 0 ? (
        <p>התקציב נוצל, ותוצאות מהמטמון עדיין מוצגות. בקשות שנדחו מאז: {formatCount(b.refused)}.</p>
      ) : (
        <p>
          נוצלו {formatShare(b.share)}. יחידה אחת היא חיפוש חדש, הסבר ל״עוד 3 אפשרויות״ או טיפים
          לקטגוריה אחת.
        </p>
      )}
    </Tile>
  );
}

export function TodaySummary({
  today,
  counter,
  cap,
  fx,
}: {
  today: DailyStats | null;
  counter: number | null;
  cap: number | null;
  fx: UsdIlsRate;
}) {
  return (
    <Section id="today" title="היום">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {today ? (
          <>
            <Tile label="חיפושים" value={formatCount(today.searches)}>
              <p>
                חדשים: {formatCount(today.fresh)}, מהמטמון: {formatCount(today.cached)}
              </p>
              <p>בלי תוצאות: {formatShare(ratio(today.zeroResults, today.searches))}</p>
            </Tile>
            <Tile label="קליקים לאלי אקספרס" value={formatCount(today.clicks)}>
              <p>הקלקה ביחס לחיפושים: {formatShare(ratio(today.clicks, today.searches))}</p>
            </Tile>
            <Tile label="עלות LLM" value={formatUsd(today.llmCostUsd)}>
              <p>
                {ils(today.llmCostUsd, fx)}, קריאות: {formatCount(today.llmCalls)}
              </p>
            </Tile>
          </>
        ) : (
          <div className="sm:col-span-2 lg:col-span-3">
            <Notice>{LOAD_FAILED}</Notice>
          </div>
        )}
        <BudgetTile counter={counter} cap={cap} />
      </div>
    </Section>
  );
}

// --- By day -------------------------------------------------------------------------------------

export function DailyTable({
  days,
  fx,
  windowDays,
}: {
  days: DailyStats[] | null;
  fx: UsdIlsRate;
  windowDays: number;
}) {
  const id = "daily";
  const title = "לפי יום";
  if (!days) {
    return (
      <Section id={id} title={title}>
        <Notice>{LOAD_FAILED}</Notice>
      </Section>
    );
  }
  const t = sumDaily(days);
  const zeroShare = (d: { zeroResults: number; searches: number }) =>
    formatShare(ratio(d.zeroResults, d.searches));
  const ctr = (d: { clicks: number; searches: number }) => formatShare(ratio(d.clicks, d.searches));
  return (
    <Section
      id={id}
      title={title}
      description={
        // "preview" rows come from examplePreview: the home page example and the SEO landing
        // pages (lib/seo/page-view.ts). Neither is a visitor's search.
        `חיפושים של מבקרים, כולל הסרת סינון ושינוי מיון. לא נספרו כחיפושים: תוצאות הדוגמה בדף הבית ובעמודי SEO (${formatCount(t.previews)}) וטעינות של ״עוד 3 אפשרויות״ (${formatCount(t.moreLoads)}). קליקים נספרים מכל העמודים, ולכן אחוז ההקלקה יכול לעבור את 100%.`
      }
    >
      <DataTable
        labelledBy={id}
        caption={`חיפושים, קליקים ועלות LLM בכל יום, ${windowDays} הימים האחרונים לפי שעון ישראל`}
        head={
          <>
            <Th>יום</Th>
            <Th numeric>חיפושים</Th>
            <Th numeric>חדשים</Th>
            <Th numeric>מהמטמון</Th>
            <Th numeric>בלי תוצאות</Th>
            <Th numeric>קליקים</Th>
            <Th numeric>הקלקה</Th>
            <Th numeric>קריאות LLM</Th>
            <Th numeric>עלות ($)</Th>
            <Th numeric>עלות (₪)</Th>
          </>
        }
        foot={
          <tr>
            <th scope="row" className="px-3 py-2.5 text-start whitespace-nowrap sm:px-4">
              סה״כ {windowDays} ימים
            </th>
            <Td numeric>{formatCount(t.searches)}</Td>
            <Td numeric>{formatCount(t.fresh)}</Td>
            <Td numeric>{formatCount(t.cached)}</Td>
            <Td numeric>{zeroShare(t)}</Td>
            <Td numeric>{formatCount(t.clicks)}</Td>
            <Td numeric>{ctr(t)}</Td>
            <Td numeric>{formatCount(t.llmCalls)}</Td>
            <Td numeric>{formatUsd(t.llmCostUsd)}</Td>
            <Td numeric>{ils(t.llmCostUsd, fx)}</Td>
          </tr>
        }
      >
        {days.map((d, i) => (
          <Row key={d.day}>
            <RowTh>
              {formatIsraelDay(d.day)}
              {i === 0 && <span className="font-normal text-muted"> (היום)</span>}
            </RowTh>
            <Td numeric>{formatCount(d.searches)}</Td>
            <Td numeric muted={!d.fresh}>
              {formatCount(d.fresh)}
            </Td>
            <Td numeric muted={!d.cached}>
              {formatCount(d.cached)}
            </Td>
            <Td numeric>{zeroShare(d)}</Td>
            <Td numeric>{formatCount(d.clicks)}</Td>
            <Td numeric>{ctr(d)}</Td>
            <Td numeric>{formatCount(d.llmCalls)}</Td>
            <Td numeric>{formatUsd(d.llmCostUsd)}</Td>
            <Td numeric>{ils(d.llmCostUsd, fx)}</Td>
          </Row>
        ))}
      </DataTable>
      {t.llmUnpricedCalls > 0 && (
        <p className="text-sm text-muted">
          קריאות למודל בלי מחיר ידוע לא נכללו בעלות ({formatCount(t.llmUnpricedCalls)}). כדי לספור
          אותן, הוסיפו את המחיר של המודל לקובץ{" "}
          <bdi dir="ltr" className="font-mono">
            lib/llm/pricing.ts
          </bdi>
          .
        </p>
      )}
    </Section>
  );
}

// --- LLM by job ---------------------------------------------------------------------------------

export function LlmByKindTable({ rows, fx }: { rows: LlmKindStats[] | null; fx: UsdIlsRate }) {
  const id = "llm";
  const title = "עלות LLM לפי משימה";
  return (
    <Section id={id} title={title}>
      {!rows ? (
        <Notice>{LOAD_FAILED}</Notice>
      ) : rows.length === 0 ? (
        <Notice>עוד אין קריאות LLM בתקופה הזו.</Notice>
      ) : (
        <DataTable
          labelledBy={id}
          caption="קריאות, טוקנים ועלות לכל משימה של ה־LLM"
          head={
            <>
              <Th>משימה</Th>
              <Th numeric>קריאות</Th>
              <Th numeric>טוקני קלט</Th>
              <Th numeric>טוקני פלט</Th>
              <Th numeric>עלות ($)</Th>
              <Th numeric>עלות (₪)</Th>
              <Th numeric>ממוצע לקריאה ($)</Th>
            </>
          }
        >
          {rows.map((r) => {
            const priced = r.calls - r.unpricedCalls;
            return (
              <Row key={r.kind}>
                <RowTh>{llmKindLabel(r.kind)}</RowTh>
                <Td numeric>{formatCount(r.calls)}</Td>
                <Td numeric>
                  {formatCount(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)}
                </Td>
                <Td numeric>{formatCount(r.outputTokens)}</Td>
                <Td numeric>{formatUsd(r.costUsd)}</Td>
                <Td numeric>{ils(r.costUsd, fx)}</Td>
                <Td numeric>{priced > 0 ? formatUsd(r.costUsd / priced) : NO_SHARE}</Td>
              </Row>
            );
          })}
        </DataTable>
      )}
    </Section>
  );
}

// --- Queries ------------------------------------------------------------------------------------

const seoHref = (q: string) => `/admin/seo/new?q=${encodeURIComponent(q)}`;

export function TopQueriesTable({ rows }: { rows: TopQuery[] | null }) {
  const id = "top-queries";
  const title = "החיפושים הנפוצים";
  return (
    <Section
      id={id}
      title={title}
      description="ניסוחים שההבדל ביניהם הוא רק ברווחים, בניקוד, במרכאות או בכתיב של ש״ח נספרים יחד. מוצג הניסוח האחרון."
    >
      {!rows ? (
        <Notice>{LOAD_FAILED}</Notice>
      ) : rows.length === 0 ? (
        <Notice>עוד אין חיפושים בתקופה הזו.</Notice>
      ) : (
        <DataTable
          labelledBy={id}
          caption="החיפושים הנפוצים בתקופה, עם מספר הפעמים ומתי נראו לאחרונה"
          head={
            <>
              <Th>חיפוש</Th>
              <Th numeric>פעמים</Th>
              <Th numeric>בלי תוצאות</Th>
              <Th>לאחרונה</Th>
              <Th>
                <span className="sr-only">פעולות</span>
              </Th>
            </>
          }
        >
          {rows.map((r) => (
            <Row key={r.queryNorm}>
              <Td wrap>
                <bdi>{r.sampleQuery}</bdi>
              </Td>
              <Td numeric>{formatCount(r.searches)}</Td>
              <Td numeric muted={!r.zeroResults}>
                {formatCount(r.zeroResults)}
              </Td>
              <Td muted>{formatDateTime(r.lastSeen)}</Td>
              <Td>
                <Link href={seoHref(r.sampleQuery)} className={`${btnSecondary} h-11 px-4 text-sm`}>
                  <FilePlus2 aria-hidden className="size-4" />
                  צרו עמוד SEO
                  <span className="sr-only"> לחיפוש: {r.sampleQuery}</span>
                </Link>
              </Td>
            </Row>
          ))}
        </DataTable>
      )}
    </Section>
  );
}

export function ZeroResultTable({ rows }: { rows: ZeroResultQuery[] | null }) {
  const id = "zero-results";
  const title = "חיפושים בלי תוצאות";
  return (
    <Section
      id={id}
      title={title}
      description="החיפושים האחרונים שאף מוצר בהם לא עבר את הסינון. שווה לבדוק אם הסינון קשוח מדי או שהחיפוש לא הובן נכון."
    >
      {!rows ? (
        <Notice>{LOAD_FAILED}</Notice>
      ) : rows.length === 0 ? (
        <Notice>אין חיפושים בלי תוצאות בתקופה הזו.</Notice>
      ) : (
        <DataTable
          labelledBy={id}
          caption="החיפושים האחרונים שלא החזירו אף תוצאה"
          head={
            <>
              <Th>חיפוש</Th>
              <Th numeric>פעמים</Th>
              <Th>לאחרונה</Th>
            </>
          }
        >
          {rows.map((r) => (
            <Row key={r.queryNorm}>
              <Td wrap>
                <bdi>{r.sampleQuery}</bdi>
              </Td>
              <Td numeric>{formatCount(r.searches)}</Td>
              <Td muted>{formatDateTime(r.lastSeen)}</Td>
            </Row>
          ))}
        </DataTable>
      )}
    </Section>
  );
}

// --- Products -----------------------------------------------------------------------------------

export function TopProductsTable({ rows }: { rows: TopProduct[] | null }) {
  const id = "top-products";
  const title = "המוצרים שהכי הקליקו עליהם";
  return (
    <Section id={id} title={title} description="קליקים על כפתורי הקנייה מכל העמודים באתר.">
      {!rows ? (
        <Notice>{LOAD_FAILED}</Notice>
      ) : rows.length === 0 ? (
        <Notice>עוד אין קליקים בתקופה הזו.</Notice>
      ) : (
        <DataTable
          labelledBy={id}
          caption="המוצרים עם הכי הרבה קליקים לאלי אקספרס בתקופה"
          head={
            <>
              <Th>מוצר</Th>
              <Th numeric>קליקים</Th>
              <Th>קליק אחרון</Th>
            </>
          }
        >
          {rows.map((r) => (
            <Row key={r.productId}>
              <Td wrap>
                <Link
                  href={`/p/${r.productId}`}
                  className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline underline-offset-4"
                >
                  {r.titleHe ?? <bdi dir="ltr">{r.titleEn ?? r.productId}</bdi>}
                </Link>
              </Td>
              <Td numeric>{formatCount(r.clicks)}</Td>
              <Td muted>{formatDateTime(r.lastClick)}</Td>
            </Row>
          ))}
        </DataTable>
      )}
    </Section>
  );
}

// --- Exchange rate ------------------------------------------------------------------------------

export function FxNote({ fx }: { fx: UsdIlsRate }) {
  const rate = fx.rate.toFixed(fx.rate < 10 ? 3 : 2);
  // BoI's lastUpdate is only checked to be a string (lib/fx/boi.ts); formatting an unparsable
  // date throws a RangeError, which would take the whole page down for one footnote.
  const published = Number.isFinite(Date.parse(fx.publishedAt))
    ? ` (פורסם ${formatDateTime(fx.publishedAt)})`
    : "";
  return (
    <p className="text-sm text-muted">
      {fx.source === "boi" ? (
        <>
          הסכומים בשקלים הם המרה משוערת לפי השער היציג של בנק ישראל: ₪{rate} לדולר{published}.
        </>
      ) : (
        <>
          בנק ישראל לא ענה, ולכן הסכומים בשקלים הם המרה משוערת לפי שער הגיבוי מההגדרות,{" "}
          <bdi dir="ltr" className="font-mono">
            USD_ILS_FALLBACK
          </bdi>
          : ₪{rate} לדולר.
        </>
      )}
    </p>
  );
}
