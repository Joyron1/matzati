import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff, ExternalLink, X } from "lucide-react";
import { StateCard } from "@/components/state-card";
import { btnMd, btnSecondary, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { formatCount, formatDateTime } from "@/lib/format";
import { ADMIN_LIMIT, OTHER_LABEL_HE } from "@/lib/recent/db";
import { cleanRecentText } from "@/lib/recent/params";
import {
  listAdminRecentSearches,
  listHiddenSearches,
  type HiddenSearch,
} from "@/lib/recent/queries";
import { RECENT_TEXT_MAX, type RecentSearch } from "@/lib/recent/types";
import { firstParam } from "@/lib/search-url";
import { SearchRowAction } from "./search-row-action";
import { StatusMessage } from "../status-message";

export const metadata: Metadata = {
  title: "חיפושים", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  hidden: "החיפוש הוסתר. הוא כבר לא מופיע בעמוד החיפושים האחרונים.",
  restored: "החיפוש הוחזר לעמוד החיפושים האחרונים.",
};

const LOAD_FAILED = "לא הצלחנו לטעון את החלק הזה. נסו לרענן את הדף בעוד רגע.";

async function load<T>(where: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    // Name and message only, never rows.
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-searches] ${where}: ${text.slice(0, 300)}`);
    return null;
  }
}

function Meta({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      {items.map((i) => (
        <div key={i.label} className="flex gap-1">
          <dt>{i.label}:</dt>
          <dd className="text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notice({ children }: { children: string }) {
  return <p className={`${card} px-5 py-4 text-muted`}>{children}</p>;
}

const rowClass = `${card} flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8`;

function ListedRow({ search }: { search: RecentSearch }) {
  const product = search.chips[0]?.label_he;
  return (
    <li className={rowClass}>
      <div className="min-w-0 space-y-2">
        <h3 className="text-lg leading-snug font-bold break-words">
          <bdi>{search.query}</bdi>
        </h3>
        <Meta
          items={[
            ...(product ? [{ label: "מוצר", value: product }] : []),
            { label: "קטגוריה", value: search.categoryHe ?? OTHER_LABEL_HE },
            { label: "תוצאות", value: formatCount(search.resultsCount) },
            // Rounded down to the hour, like everything the recent-searches reads return.
            { label: "חיפוש אחרון (מעוגל לשעה)", value: formatDateTime(search.searchedAt) },
          ]}
        />
      </div>
      <SearchRowAction queryNorm={search.queryNorm} query={search.query} mode="hide" />
    </li>
  );
}

function HiddenRow({ search }: { search: HiddenSearch }) {
  const query = search.query ?? search.queryNorm;
  return (
    <li className={rowClass}>
      <div className="min-w-0 space-y-2">
        <h3 className="text-lg leading-snug font-bold break-words">
          <bdi>{query}</bdi>
        </h3>
        <Meta items={[{ label: "הוסתר", value: formatDateTime(search.hiddenAt) }]} />
      </div>
      <SearchRowAction queryNorm={search.queryNorm} query={query} mode="restore" />
    </li>
  );
}

export default async function AdminSearchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  const params = await searchParams;
  // Own keys only: "?status=__proto__" must not pick up Object.prototype.
  const statusKey = firstParam(params.status);
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;
  // The public text filter, so any card a visitor can find is found here too.
  const text = cleanRecentText(firstParam(params.q));
  const [listed, hidden] = await Promise.all([
    load("listed", () => listAdminRecentSearches(text)),
    load("hidden", listHiddenSearches),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-4xl">חיפושים</h1>
          <p className="max-w-2xl text-muted">
            החיפושים שמופיעים בעמוד החיפושים האחרונים. חיפוש מוסתר לא יופיע שם בשום כתיב, ואפשר
            להחזיר אותו בכל רגע. חיפושים עם מספרי טלפון, מיילים או קישורים לא מופיעים שם מלכתחילה.
          </p>
        </div>
        <Link href="/searches" target="_blank" className={`${btnSecondary} ${btnMd}`}>
          <ExternalLink aria-hidden className="size-[18px]" />
          צפייה בעמוד
          <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
        </Link>
      </div>

      {status && <StatusMessage>{status}</StatusMessage>}

      {listed === null && hidden === null ? (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את החיפושים">
          <p className="max-w-prose text-muted">
            נסו לרענן את הדף בעוד רגע. אם זו הפעם הראשונה, ודאו שהמיגרציה{" "}
            <bdi dir="ltr" className="font-mono">
              recent_searches
            </bdi>{" "}
            הוחלה על מסד הנתונים.
          </p>
        </StateCard>
      ) : (
        <>
          <section aria-labelledby="listed" className="space-y-3">
            <div className="space-y-1">
              <h2 id="listed" className="font-display text-2xl">
                מופיעים באתר
              </h2>
              <p className="text-sm text-muted">
                עד {ADMIN_LIMIT} החיפושים האחרונים, כרטיס אחד לכל ניסוח, מהחדש לישן. ניסוחים שההבדל
                ביניהם הוא רק ברווחים, בניקוד, במרכאות או בכתיב של ש״ח נחשבים לאחד. חיפוש ישן יותר
                אפשר למצוא לפי מילה, כמו בעמוד הציבורי.
              </p>
            </div>
            <form action="/admin/searches" role="search" className="max-w-xl space-y-2">
              <label htmlFor="admin-searches-q" className="block text-sm font-semibold text-ink">
                חיפוש בחיפושים
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="admin-searches-q"
                  name="q"
                  type="search"
                  defaultValue={text ?? ""}
                  maxLength={RECENT_TEXT_MAX}
                  placeholder="למשל: אוזניות"
                  autoComplete="off"
                  className="h-12 min-w-0 flex-1 basis-52 rounded-full border border-line bg-surface px-4 text-base text-ink placeholder:text-muted"
                />
                <button type="submit" className={`${btnSecondary} ${btnMd}`}>
                  סינון
                </button>
                {text && (
                  <Link
                    href="/admin/searches"
                    className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
                  >
                    <X aria-hidden className="size-4" />
                    ניקוי הסינון
                  </Link>
                )}
              </div>
            </form>
            {listed === null ? (
              <Notice>{LOAD_FAILED}</Notice>
            ) : listed.length === 0 ? (
              <Notice>
                {text ? "אין חיפושים באתר שמתאימים לסינון." : "עוד אין חיפושים שמופיעים באתר."}
              </Notice>
            ) : (
              <ul className="space-y-3">
                {listed.map((s) => (
                  <ListedRow key={s.queryNorm} search={s} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="hidden" className="space-y-3">
            <div className="space-y-1">
              <h2 id="hidden" className="font-display text-2xl">
                חיפושים מוסתרים
              </h2>
              <p className="text-sm text-muted">לא מופיעים בעמוד החיפושים האחרונים.</p>
            </div>
            {hidden === null ? (
              <Notice>{LOAD_FAILED}</Notice>
            ) : hidden.length === 0 ? (
              <Notice>אין חיפושים מוסתרים.</Notice>
            ) : (
              <ul className="space-y-3">
                {hidden.map((s) => (
                  <HiddenRow key={s.queryNorm} search={s} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
