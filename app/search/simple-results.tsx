// The results of a simple search ("חיפוש פשוט", mode=simple; owner request 2026-10-19): what
// AliExpress returns for the search's English keywords, in its order, with none of our filters, and
// the way back to the smart search. Server component; the cards show 10 at a time (RevealList).
import Link from "next/link";
import { SearchX, Sparkles } from "lucide-react";
import { LinkPending } from "@/components/pending-navigation";
import { StandardProductCard } from "@/components/product-cards";
import { RevealList } from "@/components/reveal-list";
import { ResultsAnnouncer } from "@/components/search-wait/results-announcer";
import { ShareLink } from "@/components/share-link";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary } from "@/components/styles";
import { MORE_STEP, RESULTS_FIRST_VIEW } from "@/lib/config/site";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime } from "@/lib/format";
import { searchHref } from "@/lib/search-url";
import { staleFetchedAt } from "@/lib/search/freshness";
import { withPromoValidity } from "@/lib/search/promo";
import type { LoggedSearchResponse } from "@/lib/search/server";

/** What the smart search does that this one does not, said beside the button that switches. */
const SMART_NOTE =
  "הסוכן החכם בודק שכל מוצר הוא בדיוק מה שביקשתם, מסנן לפי משוב חיובי ומספר מכירות, ומסביר למה בחר.";

function SmartLink({ q, cat }: { q: string; cat?: string }) {
  return (
    <Link href={searchHref({ q, cat })} className={`${btnPrimary} ${btnMd} relative`}>
      <Sparkles aria-hidden className="size-[18px]" />
      הפעלת הסוכן החכם
      <LinkPending />
    </Link>
  );
}

export function SimpleResultsView({
  response,
  q,
  cat,
}: {
  response: LoggedSearchResponse;
  q: string;
  cat?: string;
}) {
  const results = withPromoValidity(response.results, new Date().getTime());
  const priced = response.chips.some((c) => c.kind === "max_price" || c.kind === "min_price");
  const outcome = results.length
    ? `חיפוש פשוט: ${formatCount(results.length)} מוצרים מאלי אקספרס.`
    : "אלי אקספרס לא החזירה מוצרים לחיפוש הזה.";
  const checkedAt = staleFetchedAt(response.fetched_at, new Date());
  return (
    <div data-search-results className="space-y-6">
      <h1 className="sr-only">תוצאות חיפוש פשוט עבור {q}</h1>
      <ResultsAnnouncer key={response.filters_key} text={outcome} />
      {!results.length ? (
        <StateCard Icon={SearchX} title="אלי אקספרס לא החזירה מוצרים לחיפוש הזה">
          <p className="max-w-md leading-relaxed text-muted">
            נסו לכתוב את החיפוש במילים אחרות, או לחפש עם הסוכן החכם, שמנסה גם ניסוחים נוספים.
          </p>
          <SmartLink q={q} cat={cat} />
        </StateCard>
      ) : (
        <>
          <div className="space-y-3 rounded-card border border-line bg-surface p-4 sm:p-5">
            <p className="text-xl font-bold">
              חיפוש פשוט: <bdi dir="ltr">{formatCount(results.length)}</bdi> מוצרים כמו שאלי אקספרס
              מחזירה אותם
            </p>
            <p className="text-sm leading-relaxed text-muted">
              חיפשנו באלי אקספרס{" "}
              {response.searched_keywords && (
                <>
                  ״<bdi dir="ltr">{response.searched_keywords}</bdi>״{" "}
                </>
              )}
              לפי מספר המכירות{priced ? ", בתוך התקציב" : ""}, בלי הסינון שלנו: לא בדקנו משוב חיובי,
              מספר מכירות או שהמוצר הוא בדיוק מה שביקשתם. שמות המוצרים בתרגום אוטומטי של אלי אקספרס.
              {results.some((p) => p.price_is_approx) && <> {APPROX_PRICE_NOTE}</>}
            </p>
            {checkedAt && (
              <p className="text-sm text-muted">
                התוצאות והמחירים נבדקו ב־
                <time dateTime={checkedAt}>{formatDateTime(checkedAt)}</time>. המחיר העדכני מופיע
                באלי אקספרס.
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:gap-4">
              <SmartLink q={q} cat={cat} />
              <p className="text-sm text-muted">{SMART_NOTE}</p>
            </div>
          </div>
          <RevealList
            key={response.filters_key}
            initial={RESULTS_FIRST_VIEW}
            step={MORE_STEP}
            className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5"
            items={results.map((p, i) => (
              <li key={p.product_id}>
                <StandardProductCard
                  product={p}
                  rank={i + 1}
                  q={q}
                  src="search_simple"
                  rankOf="באלי אקספרס"
                />
              </li>
            ))}
          />
          <div className="flex justify-center">
            <ShareLink
              text={`מצאתי תוצאות לחיפוש "${q}"`}
              path={searchHref({ q, cat, mode: "simple" })}
              label="שיתוף החיפוש בוואטסאפ"
            />
          </div>
        </>
      )}
    </div>
  );
}
