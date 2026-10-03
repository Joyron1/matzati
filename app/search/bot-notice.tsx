// /search for a crawler or script (lib/guard/bots.ts) when the exact search is not cached: the live
// search costs money (the language model and AliExpress), so it runs for visitors only (owner
// request 2026-10-03). A short page, status 200 and noindex (the page's generateMetadata), that
// points to the content pages a crawler may read: the home page, the hot products and the
// published landing pages (popularSearches: cached, never throws, [] on a failure).
import Link from "next/link";
import { Bot } from "lucide-react";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { PRODUCTS_PATH } from "@/lib/hot/params";
import { popularSearches } from "@/lib/seo/queries";
import { seoPath } from "@/lib/seo/slug";

const PILL =
  "inline-flex min-h-11 max-w-full items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-accent hover:text-accent-ink";

export async function BotSearchNotice({ query }: { query: string }) {
  const pages = await popularSearches();
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 pt-6 sm:px-6 sm:pt-10">
      <StateCard Icon={Bot} title="החיפוש החי פועל רק לגולשים">
        <p className="max-w-xl text-pretty text-muted">
          כל חיפוש חדש נבדק בזמן אמת מול אלי אקספרס, ולכן הוא פועל רק כשאדם מחפש מהדפדפן, לא לסורקים
          ולכלים אוטומטיים. החיפוש ״<bdi>{query}</bdi>״ עוד לא נשמר אצלנו. מוצרים שכבר בדקנו ותוצאות
          של חיפושים פופולריים נמצאים בעמודים האלה:
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/" className={`${btnPrimary} ${btnMd}`}>
            לעמוד הבית
          </Link>
          <Link href={PRODUCTS_PATH} className={`${btnSecondary} ${btnMd}`}>
            לכל המוצרים
          </Link>
        </div>
        <p className="max-w-xl text-sm text-pretty text-muted">
          הגעתם לכאן מדפדפן רגיל? חפשו שוב מעמוד הבית.
        </p>
      </StateCard>
      {pages.length > 0 && (
        <section aria-labelledby="bot-popular-title">
          <h2 id="bot-popular-title" className="text-center font-display text-2xl">
            חיפושים פופולריים
          </h2>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {pages.map((page) => (
              <li key={page.slug} className="max-w-full">
                <Link href={seoPath(page.slug)} className={PILL}>
                  <span className="truncate">{page.title_he}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
