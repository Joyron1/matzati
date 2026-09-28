// /admin/newsletter from its data: the counts, one page of active subscribers and the CSV export
// link. A server component without reads of its own, so the dev preview can render it with
// made-up rows (/dev/preview/admin-newsletter). No sending: the list is for export only.
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { formatCount } from "@/lib/format";
import type { NewsletterOverview } from "@/lib/newsletter/admin";
import {
  NEWSLETTER_PRIVACY_HREF,
  NEWSLETTER_SOURCE_LABELS,
  type NewsletterSource,
} from "@/lib/newsletter/consent";
import { DataTable, Notice, Row, Td, Th } from "../stats/ui";

export const NEWSLETTER_ADMIN_PATH = "/admin/newsletter";
export const NEWSLETTER_EXPORT_PATH = "/admin/newsletter/export";

const dateTime = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Jerusalem",
});

const sourceLabel = (source: string) =>
  Object.hasOwn(NEWSLETTER_SOURCE_LABELS, source)
    ? NEWSLETTER_SOURCE_LABELS[source as NewsletterSource]
    : source;

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className={`${card} space-y-1 p-5`}>
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="font-display text-4xl leading-none text-ink">{formatCount(value)}</dd>
      <dd className="text-sm text-muted">{hint}</dd>
    </div>
  );
}

const pagerLink =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 font-semibold text-accent-ink hover:bg-surface-2";

function Pager({ page, pages, path }: { page: number; pages: number; path: string }) {
  if (pages <= 1) return null;
  const pageHref = (n: number) => (n <= 1 ? path : `${path}?page=${n}`);
  return (
    <nav aria-label="עמודי הרשימה" className="flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={pageHref(page - 1)} className={pagerLink}>
          <ChevronRight aria-hidden className="size-4" />
          הקודמים
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted">
        עמוד {formatCount(page)} מתוך {formatCount(pages)}
      </p>
      {page < pages ? (
        <Link href={pageHref(page + 1)} className={pagerLink}>
          הבאים
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/**
 * `exportHref` null hides the export link and `path` is where the page links point (the preview
 * has no file to give and pages under its own path).
 */
export function NewsletterAdminView({
  data,
  exportHref = NEWSLETTER_EXPORT_PATH,
  path = NEWSLETTER_ADMIN_PATH,
}: {
  data: NewsletterOverview;
  exportHref?: string | null;
  path?: string;
}) {
  const { counts, rows, page, pages } = data;
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-4xl">ניוזלטר</h1>
          <p className="max-w-2xl text-muted">
            מי שנרשמו בטופס שבתחתית האתר לעדכונים על מבצעים וקופונים. כל הרשמה נשמרת עם נוסח ההסכמה
            ושעת ההסכמה. אין כאן שליחה: את הרשימה אפשר לייצא לקובץ.
          </p>
        </div>
        {exportHref && (
          // A plain link, not next/link: a file download, never prefetched.
          <a href={exportHref} download className={`${btnPrimary} ${btnMd}`}>
            <Download aria-hidden className="size-[18px]" />
            ייצוא CSV
          </a>
        )}
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Stat label="רשומים פעילים" value={counts.active} hint="נמצאים בייצוא ובטבלה למטה." />
        <Stat
          label="הסירו את ההרשמה"
          value={counts.unsubscribed}
          hint="נשמרים עם מועד ההסרה, כתיעוד. לא בייצוא."
        />
      </dl>

      {/* A plain block, not a <section>: the table's scroll region is the one landmark named by
          this heading (two regions with one name would be ambiguous). */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 id="newsletter-active" className="font-display text-2xl">
            רשומים פעילים
          </h2>
          <p className="text-sm text-muted">
            מהחדש לישן לפי שעת ההסכמה. הקובץ כולל את כולם, עם גרסת נוסח ההסכמה.
          </p>
        </div>
        {rows.length === 0 ? (
          <Notice>{counts.active === 0 ? "עוד אין רשומים." : "אין רשומים בעמוד הזה."}</Notice>
        ) : (
          <DataTable
            labelledBy="newsletter-active"
            caption={`רשומים פעילים, עמוד ${page} מתוך ${pages}`}
            head={
              <>
                <Th>אימייל</Th>
                <Th>נרשמו</Th>
                <Th>מקור</Th>
              </>
            }
          >
            {rows.map((r) => (
              <Row key={r.email}>
                <td className="px-3 py-2.5 text-start break-all sm:px-4">
                  <bdi dir="ltr">{r.email}</bdi>
                </td>
                <Td muted>{dateTime.format(new Date(r.consentedAt))}</Td>
                <Td muted>{sourceLabel(r.source)}</Td>
              </Row>
            ))}
          </DataTable>
        )}
        <Pager page={page} pages={pages} path={path} />
      </div>

      <p className="text-sm leading-relaxed text-muted">
        הסרה מהרשימה נעשית בקישור שבכל הודעה. בקשה למחוק רשומה לגמרי מטפלים בה ידנית במסד הנתונים.
        מה נאמר לנרשמים:{" "}
        <Link
          href={NEWSLETTER_PRIVACY_HREF}
          className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline underline-offset-4 hover:text-ink"
        >
          מדיניות הפרטיות
        </Link>
      </p>
    </div>
  );
}
