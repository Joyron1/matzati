import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff, Inbox, Plus } from "lucide-react";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { formatDateTime } from "@/lib/format";
import { firstParam, searchHref } from "@/lib/search-url";
import { listAllSeoPages, type SeoPage } from "@/lib/seo/queries";
import { SeoRowActions } from "./seo-row-actions";
import { StatusMessage } from "../status-message";

export const metadata: Metadata = {
  title: "דפי חיפוש", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  created: "הדף נשמר. אם סימנתם פרסום, הוא כבר באתר.",
  updated: "השינויים נשמרו.",
  deleted: "הדף נמחק.",
};

const pill = "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap";

async function loadPages(): Promise<SeoPage[] | null> {
  try {
    return await listAllSeoPages();
  } catch (err) {
    console.error(
      `[admin-seo] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return null;
  }
}

function PageMeta({ page }: { page: SeoPage }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      <div className="flex gap-1">
        <dt>כתובת:</dt>
        <dd className="text-ink">
          <bdi dir="ltr">/s/{page.slug}</bdi>
        </dd>
      </div>
      <div className="flex gap-1">
        <dt>חיפוש:</dt>
        <dd>
          <Link
            href={searchHref({ q: page.query })}
            target="_blank"
            className="font-semibold text-accent-ink underline underline-offset-4"
          >
            {page.query}
            <span className="sr-only"> (בדיקת החיפוש, נפתח בכרטיסייה חדשה)</span>
          </Link>
        </dd>
      </div>
      <div className="flex gap-1">
        <dt>עודכן:</dt>
        <dd className="text-ink">{formatDateTime(page.updated_at)}</dd>
      </div>
    </dl>
  );
}

export default async function AdminSeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  // Own keys only: "?status=__proto__" must not pick up Object.prototype.
  const statusKey = firstParam((await searchParams).status);
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;
  const pages = await loadPages();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-4xl">דפי חיפוש</h1>
          <p className="max-w-2xl text-muted">
            כל דף מציג תוצאות אמיתיות לחיפוש אחד ומתעדכן לבד. דפים מפורסמים מופיעים בדף הבית, במפת
            האתר ובמנועי חיפוש. טיוטות נראות רק כאן.
          </p>
        </div>
        <Link href="/admin/seo/new" className={`${btnPrimary} ${btnMd}`}>
          <Plus aria-hidden className="size-[18px]" />
          דף חדש
        </Link>
      </div>

      {status && <StatusMessage>{status}</StatusMessage>}

      {pages === null ? (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את הדפים">
          <p className="text-muted">נסו לרענן את הדף בעוד רגע.</p>
        </StateCard>
      ) : pages.length === 0 ? (
        <StateCard Icon={Inbox} title="עוד אין דפי חיפוש">
          <p className="text-muted">לחצו על דף חדש כדי להוסיף את הראשון.</p>
        </StateCard>
      ) : (
        <ul className="space-y-3">
          {pages.map((page) => (
            <li
              key={page.slug}
              className={`${card} flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8`}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {page.published ? (
                    <span className={`${pill} bg-accent-soft text-accent-ink`}>מפורסם</span>
                  ) : (
                    <span className={`${pill} border border-line text-muted`}>טיוטה</span>
                  )}
                </div>
                <h2 className="text-lg leading-snug font-bold break-words">{page.title_he}</h2>
                <PageMeta page={page} />
              </div>
              <SeoRowActions slug={page.slug} title={page.title_he} published={page.published} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
