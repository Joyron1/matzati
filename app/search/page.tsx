import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  Clock,
  CloudOff,
  Gauge,
  MessageCircleQuestion,
  RotateCcw,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import type { FinalResults } from "@/components/card-lines";
import { BlockerHint, BlockerList, chipBlockers } from "@/components/filter-blockers";
import { LiveFilterChips } from "@/components/live-filter-chips";
import { LinkPending, PendingNavigation, PendingResults } from "@/components/pending-navigation";
import { ResultCards } from "@/components/result-cards";
import { SearchComposer } from "@/components/search-composer";
import { ResultsAnnouncer } from "@/components/search-wait/results-announcer";
import { WAIT_ENTER_DELAY_MS } from "@/components/search-wait/schedule";
import { SearchWait } from "@/components/search-wait/search-wait";
import { ShareLink } from "@/components/share-link";
import { ShowMore } from "@/components/show-more";
import { SortBar } from "@/components/sort-bar";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime, formatWait } from "@/lib/format";
import { FILTERS } from "@/lib/ranking/config";
import {
  firstParam,
  parseArrival,
  parseFrom,
  parseSort,
  parseWithout,
  searchHref,
  type SearchArrival,
} from "@/lib/search-url";
import { staleFetchedAt } from "@/lib/search/freshness";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import {
  startSearchForRequest,
  type LoggedSearchResponse,
  type SearchFailure,
  type SearchStream,
} from "@/lib/search/server";
import type { SearchResponse, SortPreference } from "@/lib/types";

// A fresh search (parse, up to 3 AliExpress calls, explain) takes 7-15 s; give it room.
export const maxDuration = 60;

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const q = firstParam((await searchParams).q).trim();
  return { title: q ? `חיפוש: ${q}` : "חיפוש", robots: { index: false } };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const q = firstParam(params.q).trim().slice(0, MAX_QUERY_LENGTH);
  if (!q) redirect("/");

  const sort = parseSort(params.sort);
  const without = parseWithout(params.without);
  // A recent-search card or an example query: searched as usual, never listed on /searches.
  const from = parseFrom(params.from);
  // The same, plus an ad or campaign landing (utm_source, gclid): logged as search_log.origin.
  const arrival = parseArrival(params);
  const href = searchHref({ q, sort, without, from });

  // The page streams (docs/search-quality-plan.md item 15): the wait, then the chips once the
  // query is understood with a second wait under them, then the products, then their lines.
  // The first wait is this boundary's fallback, keyed by the query: loading.tsx does not show
  // again when only the search params change, and a new key is a new boundary, which shows its
  // fallback (a new query in the bar). Another sort or a removed chip keeps the key: the boundary
  // is revealed already, so the navigation keeps the chips and results on screen (busy and dimmed,
  // components/pending-navigation.tsx) until the next ones are ready, which a view of the checked
  // pool (item 13) is well within a second; only a slower one shows the wait, from AliExpress on.
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <SearchComposer variant="bar" defaultValue={q} />
      <PendingNavigation>
        <Suspense
          key={q}
          fallback={
            <SearchWait
              query={q}
              reusesParse={without.length > 0 || sort !== undefined}
              waitKey={href}
            />
          }
        >
          <SearchResults q={q} sort={sort} without={without} arrival={arrival} retryHref={href} />
        </Suspense>
      </PendingNavigation>
    </div>
  );
}

interface SearchProps {
  q: string;
  sort?: SortPreference;
  without: string[];
  retryHref: string;
}

/** Starts the search, then shows its chips and, under a second wait, its products. */
async function SearchResults({
  arrival,
  ...props
}: SearchProps & {
  arrival?: SearchArrival;
}) {
  const { q, sort, without, retryHref } = props;
  // The results carry this request's search_log uid, which their buy buttons pass to /go.
  const search = await startSearchForRequest({ q, without, sort, arrival }, await headers());
  if (!search.ok) return <Failed q={q} failure={search} retryHref={retryHref} withHeading />;
  const understood = await search.value.understood;
  if (!understood.ok)
    return <Failed q={q} failure={understood} retryHref={retryHref} withHeading />;
  const { chips, not_filtered, waitedMs } = understood.value;
  // The chip to draw attention to is known with the products (nothing passed: what blocked).
  const highlight = search.value.products.then((r) => (r.ok ? highlightIds(r.value.response) : []));

  return (
    <>
      <h1 className="sr-only">תוצאות חיפוש עבור {q}</h1>
      <LiveFilterChips
        chips={chips}
        q={q}
        sort={sort}
        without={without}
        highlight={highlight}
        notFiltered={not_filtered}
      />
      <PendingResults query={q}>
        <Suspense
          fallback={
            <SearchWait
              query={q}
              understood
              // The wait before the chips had started to show (its entrance delay was over): this
              // one goes on from it instead of fading in again.
              continues={waitedMs > WAIT_ENTER_DELAY_MS}
              waitKey={retryHref}
            />
          }
        >
          <ProductsSection stream={search.value} {...props} />
        </Suspense>
      </PendingResults>
    </>
  );
}

/** The products once ranked; while their lines are written, the cards take them in place. */
async function ProductsSection({ stream, ...props }: SearchProps & { stream: SearchStream }) {
  const shown = await stream.products;
  if (!shown.ok) return <Failed q={props.q} failure={shown} retryHref={props.retryHref} />;
  const { response, pending } = shown.value;
  const outcome =
    response.results.length > 0
      ? `בדקנו ${formatCount(response.checked_count)} מוצרים. ${formatCount(response.passed_count)} עברו את הסינון.`
      : "לא מצאנו מוצרים שעוברים את הסינון.";
  // Resolves once the lines are written and the results cached; never rejects.
  const final: FinalResults | undefined = pending
    ? stream.final.then((r) => (r.ok ? r.value.results : null))
    : undefined;

  return (
    <>
      {/* One per result set: a sort change or a removed chip is said again, also with the same counts. */}
      <ResultsAnnouncer key={response.filters_key} text={outcome} />
      <Results response={response} final={final} {...props} />
    </>
  );
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

function Results({
  response,
  final,
  q,
  sort,
  without,
}: SearchProps & {
  response: LoggedSearchResponse;
  final?: FinalResults;
}) {
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
            {shown.some((p) => p.passed_tier === "fill") ? (
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
            {shown.some((p) => p.price_is_approx) && <> {APPROX_PRICE_NOTE}</>}
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

      {/* Its own cards per result set: the page keeps its boundary across a sort change. */}
      <ResultCards key={response.filters_key} initial={shown} final={final} q={q} />

      <div className="flex flex-col items-center gap-4 pt-2">
        {blockers.length > 0 && (
          <BlockerHint blocker={blockers[0]} q={q} sort={sort} without={without} />
        )}
        {response.more_available && response.filters_key && (
          <ShowMore
            key={response.filters_key}
            filtersKey={response.filters_key}
            q={q}
            ready={final}
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

/** A search that got no results page, said once to screen readers too. */
function Failed({
  q,
  failure,
  retryHref,
  withHeading = false,
}: {
  q: string;
  failure: { error: SearchFailure; retryAfterSec?: number };
  retryHref: string;
  /** Before the chips, the page has no heading of its own yet. */
  withHeading?: boolean;
}) {
  const { Icon, title, body, retry } = failureCopy(failure.error, failure.retryAfterSec);
  return (
    <>
      {withHeading && <h1 className="sr-only">תוצאות חיפוש עבור {q}</h1>}
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
    </>
  );
}
