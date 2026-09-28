"use client";

import { LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import type { LoggedResult } from "@/lib/search-url";
import { CompactProductCard } from "./product-cards";
import { btnLg, btnMd, btnSecondary } from "./styles";

type MoreError = "not_found" | "capacity" | "rate_limited" | "unavailable";

const ERROR_TEXT: Record<MoreError, string> = {
  not_found: "התוצאות של החיפוש הזה כבר לא שמורות אצלנו. טענו את החיפוש מחדש כדי לראות עוד.",
  capacity: "המערכת עמוסה כרגע. נסו שוב מאוחר יותר.",
  rate_limited: "הגעתם למגבלת החיפושים. נסו שוב בעוד כמה דקות.",
  unavailable: "לא הצלחנו לטעון עוד אפשרויות. נסו שוב.",
};

// Each result carries the uid of the page's own search_log row (source "more"), for its /go link.
type MoreResponse = { results: LoggedResult[]; more_available: boolean };

async function fetchMore(filtersKey: string, page: number): Promise<MoreResponse | MoreError> {
  try {
    const res = await fetch("/api/search/more", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters_key: filtersKey, page }),
    });
    const data: unknown = await res.json().catch(() => null);
    const body = (data ?? {}) as Partial<MoreResponse> & { error?: unknown };
    if (res.ok && Array.isArray(body.results)) {
      return { results: body.results, more_available: body.more_available === true };
    }
    if (res.status === 404 || body.error === "not_found") return "not_found";
    if (res.status === 429 || body.error === "rate_limited") return "rate_limited";
    if (body.error === "capacity") return "capacity";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * "עוד 3 אפשרויות": loads the next ranked page of the cached result set and focuses it. `ready`
 * settles once that result set is cached: a page that shows its products before their lines
 * (plan item 15) caches them only then, so a click before it waits for it.
 */
export function ShowMore({
  filtersKey,
  q,
  ready,
}: {
  filtersKey: string;
  q: string;
  ready?: Promise<unknown>;
}) {
  const [pages, setPages] = useState<LoggedResult[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MoreError | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const focusPage = useRef<number | null>(null);

  async function load() {
    if (loading) return;
    setLoading(true);
    setError(null);
    const page = pages.length + 1;
    if (ready) await ready.catch(() => undefined);
    const result = await fetchMore(filtersKey, page);
    setLoading(false);
    if (typeof result === "string") {
      setError(result);
      return;
    }
    if (result.results.length) {
      focusPage.current = pages.length;
      setPages([...pages, result.results]);
    }
    if (!result.more_available || !result.results.length) setExhausted(true);
  }

  const label = `עוד ${RESULTS_PER_PAGE} אפשרויות`;
  // The button already shows the loading text, so it is only announced, not repeated on screen.
  const status = loading
    ? { text: "טוענים עוד אפשרויות", visible: false }
    : error
      ? { text: ERROR_TEXT[error], visible: true }
      : exhausted
        ? { text: "אין עוד אפשרויות להצגה בחיפוש הזה.", visible: true }
        : { text: "", visible: false };

  return (
    <div className="w-full space-y-5">
      {pages.map((products, i) => {
        const first = (i + 1) * RESULTS_PER_PAGE + 1;
        const last = first + products.length - 1;
        return (
          <section
            key={first}
            aria-labelledby={`more-${first}`}
            tabIndex={-1}
            ref={(el) => {
              if (el && focusPage.current === i) {
                focusPage.current = null;
                el.focus();
              }
            }}
            className="space-y-3 rounded-card outline-offset-4"
          >
            <h2 id={`more-${first}`} className="text-sm font-semibold text-muted">
              אפשרויות <bdi dir="ltr">{first}</bdi> עד <bdi dir="ltr">{last}</bdi>
            </h2>
            <div className="grid gap-5 md:grid-cols-3">
              {products.map((p, j) => (
                <CompactProductCard
                  key={p.product_id}
                  product={p}
                  rank={first + j}
                  q={q}
                  src="search_more"
                />
              ))}
            </div>
            {products.some((p) => p.price_is_approx) && (
              <p className="text-sm text-muted">{APPROX_PRICE_NOTE}</p>
            )}
          </section>
        );
      })}

      <div className="flex flex-col items-center gap-3">
        {!exhausted && error !== "not_found" && (
          <button
            type="button"
            onClick={load}
            aria-disabled={loading}
            className={`${btnSecondary} ${btnLg} w-full sm:w-auto ${loading ? "cursor-wait" : ""}`}
          >
            {loading ? (
              <LoaderCircle aria-hidden className="size-5 animate-spin" />
            ) : (
              <Plus aria-hidden className="size-5" />
            )}
            {loading ? "טוענים עוד אפשרויות..." : label}
          </button>
        )}
        <p role="status" className={status.visible ? "text-center text-sm text-muted" : "sr-only"}>
          {status.text}
        </p>
        {error === "not_found" && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`${btnSecondary} ${btnMd}`}
          >
            <RotateCcw aria-hidden className="size-[18px]" />
            טעינת החיפוש מחדש
          </button>
        )}
      </div>
    </div>
  );
}
