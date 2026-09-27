import Link from "next/link";
import { ChevronLeft, ThumbsUp } from "lucide-react";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime, formatIls, formatPct } from "@/lib/format";
import { searchHref } from "@/lib/search-url";
import { staleFetchedAt } from "@/lib/search/freshness";
import type { SearchResponse } from "@/lib/types";
import { ProductImage } from "./product-image";
import { featured } from "./styles";

/** Hero preview of what a search returns, from a real (cached) run of the example query. */
export function ResultsPreview({ response }: { response: SearchResponse }) {
  // Rendered on the server after connection(); the example can come from the 14-day cache.
  const checkedAt = staleFetchedAt(response.fetched_at, new Date());
  return (
    <section aria-labelledby="preview-title" className={`${featured} space-y-5 p-5 sm:p-6`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="preview-title" className="text-sm font-semibold text-muted">
          דוגמה לחיפוש
        </h2>
        <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
          <bdi dir="ltr">{formatCount(response.checked_count)}</bdi> נבדקו,{" "}
          <bdi dir="ltr">{formatCount(response.passed_count)}</bdi> עברו
        </span>
      </div>

      <p className="text-lg font-semibold">״{response.query}״</p>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted">הבנתי ככה:</p>
        <ul className="flex flex-wrap gap-2">
          {response.chips.map((chip) => (
            <li
              key={chip.id}
              className="rounded-full bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent-ink"
            >
              {chip.label_he}
            </li>
          ))}
        </ul>
      </div>

      <ol className="divide-y divide-line rounded-card border border-line">
        {response.results.map((p, i) => (
          <li key={p.product_id} className="flex items-center gap-3 p-3">
            <ProductImage
              src={p.image_urls[0]}
              alt=""
              className="size-14 shrink-0 rounded-xl"
              iconClassName="size-6"
              sizes="56px"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                <span className="text-muted">{i + 1}. </span>
                {p.title_he}
              </p>
              <p className="mt-0.5 flex items-center gap-3 text-sm text-muted">
                <bdi dir="ltr" className="font-bold text-ink">
                  {formatIls(p.price_ils, p.price_is_approx)}
                </bdi>
                {p.positive_feedback_pct !== null && (
                  <span className="flex items-center gap-1">
                    <ThumbsUp aria-hidden className="size-3.5 text-accent" />
                    <bdi dir="ltr">{formatPct(p.positive_feedback_pct)}</bdi>
                    <span className="sr-only">משוב חיובי</span>
                  </span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {(checkedAt || response.results.some((p) => p.price_is_approx)) && (
        <div className="space-y-1 text-xs text-muted">
          {checkedAt && (
            <p>
              התוצאות והמחירים נבדקו ב־<time dateTime={checkedAt}>{formatDateTime(checkedAt)}</time>
              . המחיר העדכני מופיע באלי אקספרס.
            </p>
          )}
          {response.results.some((p) => p.price_is_approx) && <p>{APPROX_PRICE_NOTE}</p>}
        </div>
      )}

      <Link
        // Not typed by the visitor, so never listed on /searches.
        href={searchHref({ q: response.query, from: "example" })}
        className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        לתוצאות המלאות של הדוגמה
        <ChevronLeft aria-hidden className="size-4" />
      </Link>
    </section>
  );
}
