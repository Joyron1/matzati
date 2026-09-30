// The complete results of a /search view, rendered on the server once the search is done (every
// line written, or the lines built from the data when that step failed), and the failure states.
// app/search/page.tsx passes them to components/search-view.tsx as one promise, so they show at once
// in place of the waiting screen. Server components only, with nothing left to wait for inside.
import Link from "next/link";
import {
  Clock,
  CloudOff,
  Gauge,
  MessageCircleQuestion,
  RotateCcw,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { BlockerHint, BlockerList, chipBlockers } from "@/components/filter-blockers";
import { FilterChips } from "@/components/filter-chips";
import { LinkPending } from "@/components/pending-navigation";
import { ExtraResultCards, ResultCards } from "@/components/result-cards";
import { ResultsAnnouncer } from "@/components/search-wait/results-announcer";
import type { RankedSignal, UnderstoodSignal } from "@/components/search-wait/signals";
import { ShareLink } from "@/components/share-link";
import { ShowMore } from "@/components/show-more";
import { SortBar } from "@/components/sort-bar";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { FIRST_MORE_PAGE } from "@/lib/config/site";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime, formatWait } from "@/lib/format";
import { FILTERS } from "@/lib/ranking/config";
import { searchHref } from "@/lib/search-url";
import { staleFetchedAt } from "@/lib/search/freshness";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import type {
  LoggedSearchResponse,
  SearchFailure,
  SearchStream,
  Staged,
} from "@/lib/search/server";
import type { FilterChip, SearchResponse, SortPreference } from "@/lib/types";

export interface SearchViewProps {
  q: string;
  sort?: SortPreference;
  without: string[];
  /** The page's own URL: "ניסיון נוסף" reloads it. */
  retryHref: string;
}

/** The chips once the query is understood (the wait shows them), or null when it failed first. */
export async function understoodSignal(
  started: Promise<Staged<SearchStream>>,
): Promise<UnderstoodSignal | null> {
  const search = await started;
  if (!search.ok) return null;
  const understood = await search.value.understood;
  return understood.ok ? { chips: understood.value.chips } : null;
}

/** The products once ranked (the wait then says their lines are being written), or null. */
export async function rankedSignal(
  started: Promise<Staged<SearchStream>>,
): Promise<RankedSignal | null> {
  const search = await started;
  if (!search.ok) return null;
  const shown = await search.value.products;
  if (!shown.ok) return null;
  const { response, pending } = shown.value;
  return { writing: pending, checked: response.checked_count, passed: response.passed_count };
}

/**
 * The view once complete: the products with every line (or with the lines from the data when
 * writing them failed), else the failure. Never rejects: each stage resolves with its failure.
 */
export async function completeResults(
  started: Promise<Staged<SearchStream>>,
  props: SearchViewProps,
): Promise<ReactNode> {
  const search = await started;
  if (!search.ok) return <Failed {...props} failure={search} />;
  const understood = await search.value.understood;
  if (!understood.ok) return <Failed {...props} failure={understood} />;
  const shown = await search.value.products;
  if (!shown.ok) {
    return <Failed {...props} failure={shown} chips={understood.value.chips} />;
  }
  let response = shown.value.response;
  if (shown.value.pending) {
    // Not ok only when caching the finished set failed: the products as ranked, with AliExpress's
    // titles and the lines from the data, are still true.
    const final = await search.value.final;
    if (final.ok) response = final.value;
  }
  return <SearchResultsView response={response} {...props} />;
}

/** Nothing passed: what blocked it, else the chips that are price bounds. Else none. */
function highlightIds(response: SearchResponse): string[] {
  if (response.results.length) return [];
  const blockers = chipBlockers(response.blockers, response.chips);
  if (blockers.length) return [blockers[0].chip.id];
  return response.chips
    .filter((c) => c.kind === "max_price" || c.kind === "min_price")
    .map((c) => c.id);
}

/** The results page of one view: the chips, what was checked, the cards and what comes next. */
export function SearchResultsView({
  response,
  ...props
}: SearchViewProps & { response: LoggedSearchResponse }) {
  const { q, sort, without } = props;
  const outcome =
    response.results.length > 0
      ? `בדקנו ${formatCount(response.checked_count)} מוצרים. ${formatCount(response.passed_count)} עברו את הסינון.`
      : "לא מצאנו מוצרים שעוברים את הסינון.";
  return (
    <div data-search-results className="space-y-6">
      <h1 className="sr-only">תוצאות חיפוש עבור {q}</h1>
      <FilterChips
        chips={response.chips}
        q={q}
        sort={sort}
        without={without}
        highlightIds={highlightIds(response)}
        notFiltered={response.not_filtered}
      />
      {/* One per result set: a sort change or a removed chip is said again, also with the same counts. */}
      <ResultsAnnouncer key={response.filters_key} text={outcome} />
      <Results response={response} q={q} sort={sort} without={without} />
    </div>
  );
}

function Results({
  response,
  q,
  sort,
  without,
}: Pick<SearchViewProps, "q" | "sort" | "without"> & { response: LoggedSearchResponse }) {
  const priceChips = response.chips.filter((c) => c.kind === "max_price" || c.kind === "min_price");
  // What kept the checked products out (item 12), most useful first; never a product that failed.
  const blockers = chipBlockers(response.blockers, response.chips);

  if (!response.results.length) {
    const removable = response.chips.some((c) => c.removable);
    const removableRequirement = response.chips.some((c) => c.removable && c.kind === "must_have");
    // Without blockers, the price is the one filter worth suggesting: the price bounds limited
    // what AliExpress sent, so the checked products cannot show what they kept out. Without a
    // price, a requirement is: when two block only together no single one is a blocker, yet
    // removing one also searches without its words. Results cached before blockers existed
    // (response.blockers absent) get the older advice.
    const advice =
      priceChips.length > 0
        ? "נסו להוריד את סינון המחיר."
        : removableRequirement || (removable && response.blockers === undefined)
          ? "נסו להסיר את אחד הסינונים שלמעלה."
          : "נסו לכתוב את החיפוש במילים אחרות או בצורה כללית יותר.";
    return (
      <StateCard Icon={SearchX} title="לא מצאנו מוצרים שעוברים את הסינון">
        <p className="max-w-md leading-relaxed text-muted">
          {response.checked_count > 0 ? (
            <>
              בדקנו <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> מוצרים ואף אחד לא
              עבר.
            </>
          ) : (
            "אלי אקספרס לא החזירה מוצרים לחיפוש הזה."
          )}
          {blockers.length === 0 && <> {advice}</>}
        </p>
        {blockers.length > 0 ? (
          <BlockerList blockers={blockers} q={q} sort={sort} without={without} />
        ) : (
          priceChips.length > 0 && (
            <Link
              href={searchHref({
                q,
                sort,
                without: [...without, ...priceChips.map((c) => c.id)],
              })}
              className={`${btnPrimary} ${btnMd} relative`}
            >
              {priceChips.length === 1
                ? `הסרת הסינון: ${priceChips[0].label_he}`
                : "הסרת סינון המחיר"}
              <LinkPending />
            </Link>
          )
        )}
      </StateCard>
    );
  }

  const shown = response.results;
  // Places 6-10 (standard cards, no line). A response without them (mock data) keeps the old
  // "עוד N" from place 6.
  const extra = response.extra_results;
  const firstView = [...shown, ...(extra ?? [])];
  const moreFromPage = extra ? FIRST_MORE_PAGE : 1;
  const moreAvailable = extra ? response.more_after_first_view === true : response.more_available;
  // Server-rendered with the server's clock; results can come from the 14-day cache.
  const checkedAt = staleFetchedAt(response.fetched_at, new Date());
  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-xl font-bold">
            בדקנו <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> מוצרים.{" "}
            <span className="text-accent-ink">
              <bdi dir="ltr">{formatCount(response.passed_count)}</bdi> עברו את הסינון.
            </span>
          </p>
          <p className="text-sm text-muted">
            {/* When the second trust tier filled in, one pair of numbers would be false for some
                cards, so the line names the criteria and links to the full rules instead. */}
            {firstView.some((p) => p.passed_tier === "fill") ? (
              <>
                הסינון: משוב חיובי ומספר מכירות ב־30 הימים האחרונים לפי{" "}
                <Link
                  href="/terms#accuracy"
                  className="underline underline-offset-4 hover:text-ink"
                >
                  הספים שלנו
                </Link>
              </>
            ) : (
              <>
                הסינון: <bdi dir="ltr">{FILTERS.minPositiveFeedbackPct}%</bdi> משוב חיובי ומעלה ו־
                <bdi dir="ltr">{formatCount(FILTERS.minUnitsSold)}</bdi> מכירות ומעלה ב־30 הימים
                האחרונים
              </>
            )}
            {priceChips.length > 0 ? ", בתוך התקציב" : ""}.
            {firstView.some((p) => p.price_is_approx) && <> {APPROX_PRICE_NOTE}</>}
          </p>
          {checkedAt && (
            <p className="text-sm text-muted">
              התוצאות והמחירים נבדקו ב־<time dateTime={checkedAt}>{formatDateTime(checkedAt)}</time>
              . המחיר העדכני מופיע באלי אקספרס.
            </p>
          )}
        </div>
        <SortBar q={q} active={response.sort} without={without} />
      </div>

      {/* Its own cards per result set: a sort change keeps the page, not the cards. */}
      <ResultCards key={response.filters_key} results={shown} q={q} />
      {extra && <ExtraResultCards key={`extra-${response.filters_key}`} results={extra} q={q} />}

      <div className="flex flex-col items-center gap-4 pt-2">
        {blockers.length > 0 && (
          <BlockerHint blocker={blockers[0]} q={q} sort={sort} without={without} />
        )}
        {moreAvailable && response.filters_key && (
          <ShowMore
            key={response.filters_key}
            filtersKey={response.filters_key}
            q={q}
            fromPage={moreFromPage}
          />
        )}
        <ShareLink text={`מצאתי תוצאות לחיפוש "${q}"`} label="שיתוף החיפוש בוואטסאפ" />
      </div>
    </>
  );
}

interface FailureCopy {
  Icon: LucideIcon;
  title: string;
  body: string;
  retry: boolean;
}

function failureCopy(error: SearchFailure, retryAfterSec?: number): FailureCopy {
  switch (error) {
    case "rate_limited":
      return {
        Icon: Clock,
        title: "הגעתם למגבלת החיפושים",
        body: `כדי שהאתר יישאר זמין לכולם, יש מגבלה על מספר החיפושים. ${
          retryAfterSec ? `אפשר לחפש שוב בעוד ${formatWait(retryAfterSec)}.` : "נסו שוב מאוחר יותר."
        }`,
        retry: false,
      };
    case "capacity":
      return {
        Icon: Gauge,
        title: "המערכת עמוסה כרגע",
        body: "הגענו למכסת החיפושים החדשים להיום. חיפושים שנעשו לאחרונה עדיין זמינים. נסו שוב מאוחר יותר.",
        retry: false,
      };
    case "parse_failed":
      return {
        Icon: MessageCircleQuestion,
        title: "לא הצלחנו להבין את החיפוש, נסו לנסח אחרת",
        body: "כתבו מה המוצר, ואם אפשר גם למי הוא ומה התקציב. למשל: ״מחזיק טלפון לרכב עד 50 ש״ח״.",
        retry: false,
      };
    case "invalid_query":
      return {
        Icon: MessageCircleQuestion,
        title: "לא הצלחנו לקרוא את החיפוש",
        body: `כתבו מה אתם מחפשים, עד ${MAX_QUERY_LENGTH} תווים, ונסו שוב.`,
        retry: false,
      };
    case "upstream":
      return {
        Icon: CloudOff,
        title: "אלי אקספרס לא עונה כרגע",
        body: "לא הצלחנו לקבל מוצרים מאלי אקספרס. נסו שוב בעוד כמה דקות.",
        retry: true,
      };
    case "llm":
      return {
        Icon: CloudOff,
        title: "לא הצלחנו לעבד את החיפוש כרגע",
        body: "השירות שמבין את החיפוש לא ענה בזמן. זו תקלה זמנית שלנו, לא של אלי אקספרס. נסו שוב בעוד כמה דקות.",
        retry: true,
      };
    case "unavailable":
    default:
      return {
        Icon: CloudOff,
        title: "החיפוש לא זמין כרגע",
        body: "משהו השתבש אצלנו. נסו שוב בעוד כמה דקות.",
        retry: true,
      };
  }
}

/**
 * A search that got no results page, said once to screen readers too. After the query was
 * understood its chips show above it, so one can be removed.
 */
function Failed({
  q,
  sort,
  without,
  retryHref,
  failure,
  chips,
}: SearchViewProps & {
  failure: { error: SearchFailure; retryAfterSec?: number };
  chips?: FilterChip[];
}) {
  const { Icon, title, body, retry } = failureCopy(failure.error, failure.retryAfterSec);
  return (
    <div data-search-results className="space-y-6">
      <h1 className="sr-only">תוצאות חיפוש עבור {q}</h1>
      {chips && <FilterChips chips={chips} q={q} sort={sort} without={without} />}
      <ResultsAnnouncer text={title} />
      <StateCard Icon={Icon} title={title}>
        <p className="max-w-md leading-relaxed text-muted">{body}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {retry && (
            // A full reload, so the search really runs again.
            <a href={retryHref} className={`${btnPrimary} ${btnMd}`}>
              <RotateCcw aria-hidden className="size-[18px]" />
              ניסיון נוסף
            </a>
          )}
          <Link href="/" className={`${btnSecondary} ${btnMd}`}>
            לדף הבית
          </Link>
        </div>
      </StateCard>
    </div>
  );
}
