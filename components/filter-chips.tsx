import Link from "next/link";
import { RotateCcw, X } from "lucide-react";
import { searchCategoryChip, searchHref } from "@/lib/search-url";
import type { FilterChip, SortPreference } from "@/lib/types";
import { LinkPending, RestoreFocus } from "./pending-navigation";

interface FilterChipsProps {
  chips: FilterChip[];
  q: string;
  /** Sort override from the URL, kept when a chip is removed. */
  sort?: SortPreference;
  without: string[];
  /**
   * The category the search is limited to (/search?cat=): shown first as a removable chip
   * (removing it is the same search without the category), and kept by every other link here.
   */
  cat?: string;
  /** Chips to draw attention to, e.g. the price filter when nothing passed. */
  highlightIds?: string[];
  /** Stated needs that are not filters (SearchResponse.not_filtered), named under the chips. */
  notFiltered?: string[];
}

/** "״א״", "״א״ ו״ב״", "״א״, ״ב״ ו״ג״". */
function quotedList(labels: string[]): string {
  const quoted = labels.map((l) => `״${l}״`);
  return quoted.length < 2
    ? quoted.join("")
    : `${quoted.slice(0, -1).join(", ")} ו${quoted.at(-1)}`;
}

/**
 * A need the visitor stated that no title can show, so it is not a filter (plan item 8): said
 * plainly, so the chips never imply it was checked.
 */
export function notFilteredNote(labels: string[]): string {
  const them = labels.length === 1 ? "את זה" : "אותם";
  return `את ${quotedList(labels)} לא סיננו, רק העדפנו מוצרים שהשם שלהם מזכיר ${them}.`;
}

/**
 * The search without its category: the same query, sort and removed chips (the parse is reused, so
 * no parse call; the results are the unrestricted search's own).
 */
export function categoryRemovedHref({
  q,
  sort,
  without,
}: Pick<FilterChipsProps, "q" | "sort" | "without">): string {
  return searchHref({ q, sort, without });
}

/**
 * "הבנתי ככה" row. Removing a chip searches without that filter: from the products already checked
 * when enough of them pass (lib/search/pool.ts), else anew. The results on screen stay meanwhile
 * (components/pending-navigation.tsx).
 */
export function FilterChips({
  chips,
  q,
  sort,
  without,
  cat,
  highlightIds = [],
  notFiltered = [],
}: FilterChipsProps) {
  const categoryChip = searchCategoryChip(cat);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-sm font-semibold text-muted">הבנתי ככה:</span>
      <ul className="flex flex-wrap gap-2">
        {categoryChip && (
          <li>
            <Link
              href={categoryRemovedHref({ q, sort, without })}
              aria-label={`הסרת הסינון: ${categoryChip}`}
              className="relative inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent-soft ps-4 pe-3 text-sm font-semibold text-accent-ink hover:bg-accent hover:text-on-accent"
            >
              {categoryChip}
              <X aria-hidden className="size-4" />
              <LinkPending />
            </Link>
          </li>
        )}
        {chips.map((chip) => {
          const ring = highlightIds.includes(chip.id)
            ? "ring-2 ring-gold ring-offset-2 ring-offset-bg"
            : "";
          return (
            <li key={chip.id}>
              {chip.removable ? (
                <Link
                  href={searchHref({ q, sort, without: [...without, chip.id], cat })}
                  aria-label={`הסרת הסינון: ${chip.label_he}`}
                  className={`relative inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent-soft ps-4 pe-3 text-sm font-semibold text-accent-ink hover:bg-accent hover:text-on-accent ${ring}`}
                >
                  {chip.label_he}
                  <X aria-hidden className="size-4" />
                  <LinkPending />
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
          href={searchHref({ q, sort, cat })}
          data-restore-filters
          className="relative inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          <RotateCcw aria-hidden className="size-4" />
          החזרת כל הסינונים
          <LinkPending />
        </Link>
      )}
      {notFiltered.length > 0 && (
        <p className="w-full text-sm text-pretty text-muted">{notFilteredNote(notFiltered)}</p>
      )}
      {/* A removed chip took keyboard focus with it: it goes to the next place to act. */}
      <RestoreFocus
        when={`${without.join(",")}|${cat ?? ""}`}
        targets={["a[data-restore-filters]", "a"]}
      />
    </div>
  );
}
