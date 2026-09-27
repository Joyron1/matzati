import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Clock,
  CloudOff,
  Gauge,
  MessageCircleQuestion,
  RotateCcw,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { FilterChips } from "@/components/filter-chips";
import { CompactProductCard, FeaturedProductCard } from "@/components/product-cards";
import { SearchComposer } from "@/components/search-composer";
import { ShareLink } from "@/components/share-link";
import { ShowMore } from "@/components/show-more";
import { SortBar } from "@/components/sort-bar";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatWait } from "@/lib/format";
import { FILTERS } from "@/lib/ranking/config";
import { firstParam, parseSort, parseWithout, searchHref } from "@/lib/search-url";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import { searchForRequest, type SearchFailure } from "@/lib/search/server";
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
  const result = await searchForRequest({ q, without, sort }, await headers());

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <h1 className="sr-only">תוצאות חיפוש עבור {q}</h1>
      <SearchComposer variant="bar" defaultValue={q} />
      {result.ok ? (
        <Results response={result.response} q={q} sort={sort} without={without} />
      ) : (
        <SearchError
          error={result.error}
          retryAfterSec={result.retryAfterSec}
          retryHref={searchHref({ q, sort, without })}
        />
      )}
    </div>
  );
}

function Results({
  response,
  q,
  sort,
  without,
}: {
  response: SearchResponse;
  q: string;
  sort?: SortPreference;
  without: string[];
}) {
  const [top, ...rest] = response.results;
  const priceChips = response.chips.filter((c) => c.kind === "max_price" || c.kind === "min_price");
  const chips = (
    <FilterChips
      chips={response.chips}
      q={q}
      sort={sort}
      without={without}
      highlightIds={top ? [] : priceChips.map((c) => c.id)}
    />
  );

  if (!top) {
    const removable = response.chips.some((c) => c.removable);
    return (
      <>
        {chips}
        <StateCard Icon={SearchX} title="לא מצאנו מוצרים שעוברים את הסינון">
          <p className="max-w-md leading-relaxed text-muted">
            {response.checked_count > 0 ? (
              <>
                בדקנו <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> מוצרים ואף אחד לא
                עבר.{" "}
              </>
            ) : (
              "אלי אקספרס לא החזירה מוצרים לחיפוש הזה. "
            )}
            {priceChips.length > 0
              ? "נסו להוריד את סינון המחיר."
              : removable
                ? "נסו להסיר את אחד הסינונים שלמעלה."
                : "נסו לכתוב את החיפוש במילים אחרות או בצורה כללית יותר."}
          </p>
          {priceChips.length > 0 && (
            <Link
              href={searchHref({ q, sort, without: [...without, ...priceChips.map((c) => c.id)] })}
              className={`${btnPrimary} ${btnMd}`}
            >
              {priceChips.length === 1
                ? `הסרת הסינון: ${priceChips[0].label_he}`
                : "הסרת סינון המחיר"}
            </Link>
          )}
        </StateCard>
      </>
    );
  }

  const shown = response.results;
  return (
    <>
      {chips}
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
                <Link href="/disclosure" className="underline underline-offset-4 hover:text-ink">
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
        </div>
        <SortBar q={q} active={response.sort} without={without} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <FeaturedProductCard product={top} rank={1} q={q} />
        {rest.length > 0 && (
          <div className="grid gap-5">
            {rest.map((p, i) => (
              <CompactProductCard key={p.product_id} product={p} rank={i + 2} q={q} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 pt-2">
        {response.more_available && response.filters_key && (
          <ShowMore key={response.filters_key} filtersKey={response.filters_key} q={q} />
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

function SearchError({
  error,
  retryAfterSec,
  retryHref,
}: {
  error: SearchFailure;
  retryAfterSec?: number;
  retryHref: string;
}) {
  const { Icon, title, body, retry } = failureCopy(error, retryAfterSec);
  return (
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
  );
}
