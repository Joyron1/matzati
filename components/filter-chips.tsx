import Link from "next/link";
import { RotateCcw, X } from "lucide-react";
import { searchHref } from "@/lib/search-url";
import type { FilterChip, SortPreference } from "@/lib/types";

interface FilterChipsProps {
  chips: FilterChip[];
  q: string;
  sort: SortPreference;
  without: string[];
  /** Chip to draw attention to, e.g. the price filter when nothing passed. */
  highlightId?: string;
}

/** "הבנתי ככה" row. Removing a chip re-runs the search without that filter. */
export function FilterChips({ chips, q, sort, without, highlightId }: FilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-sm font-semibold text-muted">הבנתי ככה:</span>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const ring =
            chip.id === highlightId ? "ring-2 ring-gold ring-offset-2 ring-offset-bg" : "";
          return (
            <li key={chip.id}>
              {chip.removable ? (
                <Link
                  href={searchHref({ q, sort, without: [...without, chip.id] })}
                  aria-label={`הסרת הסינון: ${chip.label_he}`}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent-soft ps-4 pe-3 text-sm font-semibold text-accent-ink hover:bg-accent hover:text-on-accent ${ring}`}
                >
                  {chip.label_he}
                  <X aria-hidden className="size-4" />
                </Link>
              ) : (
                <span className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink">
                  {chip.label_he}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {without.length > 0 && (
        <Link
          href={searchHref({ q, sort })}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          <RotateCcw aria-hidden className="size-4" />
          החזרת כל הסינונים
        </Link>
      )}
    </div>
  );
}
