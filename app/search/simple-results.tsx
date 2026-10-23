// The results of a simple search ("חיפוש פשוט", mode=simple; owner request 2026-10-19): what
// AliExpress returns for the search's English keywords, in its order, with none of our filters, and
// the way back to the smart search. A photo or link search (mode=match, owner request 2026-10-23)
// shows the same page with its exact matches first and the others under their own heading.
// Server component; the cards show 10 at a time (RevealList).
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
  const match = response.match === true;
  const exact = response.exact_count ?? 0;
  const outcome = !results.length
    ? "אלי אקספרס לא החזירה מוצרים לחיפוש הזה."
    : match
      ? `${formatCount(exact)} מוצרים מתאימים למה שחיפשתם, מתוך ${formatCount(results.length)}.`
      : `חיפוש פשוט: ${formatCount(results.length)} מוצרים מאלי אקספרס.`;
  const cards = results.map((p, i) => (
    <li key={p.product_id}>
      <StandardProductCard
        product={p}
        rank={i + 1}
        q={q}
        src={match ? "search_match" : "search_simple"}
        rankOf={match ? "בהתאמה" : "באלי אקספרס"}
      />
    </li>
  ));
  // A match search: the products that are not exact matches under their own heading.
  if (match && exact > 0 && exact < cards.length) {
    cards.splice(
      exact,
      0,
      <li key="less" className="col-span-full pt-2">
        <h2 className="text-lg font-bold">מוצרים שפחות מתאימים</h2>
        <p className="text-sm text-muted">
          מאותו חיפוש באלי אקספרס, אבל השם שלהם לא מראה שהם בדיוק מה שחיפשתם.
        </p>
      </li>,
    );
  }
  const checkedAt = staleFetchedAt(response.fetched_at, new Date());
  return (
    <div data-search-results className="space-y-6">
      <h1 className="sr-only">
        {match ? "מוצרים שמתאימים לחיפוש" : "תוצאות חיפוש פשוט"} עבור {q}
      </h1>
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
            {match ? (
              <>
                <p className="text-xl font-bold">
                  {exact > 0 ? (
                    <>
                      <bdi dir="ltr">{formatCount(exact)}</bdi> מוצרים מתאימים למה שחיפשתם
                    </>
                  ) : (
                    "לא מצאנו מוצר שהשם שלו מראה שהוא בדיוק מה שחיפשתם"
                  )}
                </p>
                <p className="text-sm leading-relaxed text-muted">
                  זיהינו את המוצר וחיפשנו באלי אקספרס{" "}
                  {response.searched_keywords && (
                    <>
                      ״<bdi dir="ltr">{response.searched_keywords}</bdi>״
                    </>
                  )}
                  . ראשונים המוצרים שהשם שלהם מתאים לסוג המוצר ולפרטים שזיהינו, מהאמינים ביותר (משוב
                  חיובי ומכירות). שמות המוצרים בתרגום אוטומטי של אלי אקספרס.
                  {results.some((p) => p.price_is_approx) && <> {APPROX_PRICE_NOTE}</>}
                </p>
              </>
            ) : (
              <p className="text-xl font-bold">
                חיפוש פשוט: <bdi dir="ltr">{formatCount(results.length)}</bdi> מוצרים כמו שאלי
                אקספרס מחזירה אותם
              </p>
            )}
            {!match && (
              <p className="text-sm leading-relaxed text-muted">
                חיפשנו באלי אקספרס{" "}
                {response.searched_keywords && (
                  <>
                    ״<bdi dir="ltr">{response.searched_keywords}</bdi>״{" "}
                  </>
                )}
                לפי מספר המכירות{priced ? ", בתוך התקציב" : ""}, בלי הסינון שלנו: לא בדקנו משוב
                חיובי, מספר מכירות או שהמוצר הוא בדיוק מה שביקשתם. שמות המוצרים בתרגום אוטומטי של
                אלי אקספרס.
                {results.some((p) => p.price_is_approx) && <> {APPROX_PRICE_NOTE}</>}
              </p>
            )}
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
            items={cards}
          />
          <div className="flex justify-center">
            <ShareLink
              text={`מצאתי תוצאות לחיפוש "${q}"`}
              path={searchHref({ q, cat, mode: match ? "match" : "simple" })}
              label="שיתוף החיפוש בוואטסאפ"
            />
          </div>
        </>
      )}
    </div>
  );
}
