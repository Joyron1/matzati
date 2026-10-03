import Link from "next/link";
import { searchHref } from "@/lib/search-url";
import type { SortPreference } from "@/lib/types";
import { LinkPending, RestoreFocus } from "./pending-navigation";

const SORTS: { value: SortPreference; label: string }[] = [
  { value: "best_value", label: "מחיר ואיכות" },
  { value: "cheapest", label: "מחיר נמוך" },
  { value: "most_popular", label: "הכי נמכרים" },
];

/**
 * Refine buttons. Each sets an explicit sort, which overrides the one parsed from the query. The
 * results on screen stay while the next order is prepared (components/pending-navigation.tsx), and
 * keyboard focus stays on the sort chosen, which is then the current one.
 */
export function SortBar({
  q,
  active,
  without,
  cat,
}: {
  q: string;
  /** The sort the results were ranked with (parsed or overridden). */
  active: SortPreference;
  without: string[];
  /** The category the search is limited to, kept by a sort change. */
  cat?: string;
}) {
  return (
    <nav aria-label="סדר התוצאות" className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-muted">סדר לפי:</span>
      {SORTS.map((s) => {
        const current = s.value === active;
        return (
          <Link
            key={s.value}
            href={searchHref({ q, sort: s.value, without, cat })}
            aria-current={current ? "true" : undefined}
            className={`relative inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${
              current
                ? "bg-ink text-bg"
                : "border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink"
            }`}
          >
            {s.label}
            <LinkPending />
          </Link>
        );
      })}
      <RestoreFocus when={active} targets={['[aria-current="true"]']} />
    </nav>
  );
}
