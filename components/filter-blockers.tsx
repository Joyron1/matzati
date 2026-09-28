import Link from "next/link";
import { X } from "lucide-react";
import { btnSecondary } from "@/components/styles";
import { formatCount } from "@/lib/format";
import { SMALL_CAPACITY_FACTOR } from "@/lib/ranking/config";
import { searchHref } from "@/lib/search-url";
import type { FilterBlocker, FilterChip, SortPreference } from "@/lib/types";
import { LinkPending } from "./pending-navigation";

// "What blocked" (docs/search-quality-plan.md, item 12): for a search with fewer than 3 results,
// the filters whose removal lets more of the checked products through, with how many. Only the
// count is shown: a product that did not pass the filters never is.

/** A blocker with the chip that removes it. */
export interface ChipBlocker extends FilterBlocker {
  chip: FilterChip;
}

/** The response's blockers that a removable chip on the page still removes, most useful first. */
export function chipBlockers(
  blockers: readonly FilterBlocker[] | undefined,
  chips: readonly FilterChip[],
): ChipBlocker[] {
  return (blockers ?? []).flatMap((b) => {
    const chip = chips.find((c) => c.id === b.chip_id && c.removable);
    return chip ? [{ ...b, chip }] : [];
  });
}

interface LinkProps {
  q: string;
  sort?: SortPreference;
  without: string[];
}

/**
 * "בלי הסינון הזה היו עוברים N מהמוצרים שכבר בדקנו", with the singular for one product. The count
 * is of the products already checked: removing the filter searches again (without its words, see
 * applyOverrides), and that search may check and pass a different number, so the sentence says
 * "would" and "already".
 */
function passesWithout(n: number, lead: string) {
  return n === 1 ? (
    <>{lead} היה עובר מוצר אחד מהמוצרים שכבר בדקנו.</>
  ) : (
    <>
      {lead} היו עוברים <bdi dir="ltr">{formatCount(n)}</bdi> מהמוצרים שכבר בדקנו.
    </>
  );
}

/**
 * Why nothing passed, one filter at a time. With nothing passing, the products that pass every
 * other filter all fail this one, so each sentence is true of the checked products. A capacity of
 * a "small" search also fails titles that state a bigger one (size_cap), so its sentence says so.
 */
function whatBlocked(b: ChipBlocker): string {
  const label = `״${b.chip.label_he}״`;
  if (b.chip.kind === "must_have") {
    if (b.size_cap) {
      return `אף מוצר שעבר את שאר הסינונים לא מציין בכותרת ${label} או עד פי ${SMALL_CAPACITY_FACTOR} ממנו (ביקשתם מוצר קטן).`;
    }
    return b.title_matches === 0
      ? `אף מוצר שבדקנו לא מציין בכותרת ${label}.`
      : `אף מוצר שעבר את שאר הסינונים לא מציין בכותרת ${label}.`;
  }
  return `אף מוצר שעבר את שאר הסינונים לא נמצא בטווח המחיר ${label}.`;
}

function removeHref(b: ChipBlocker, { q, sort, without }: LinkProps) {
  return searchHref({ q, sort, without: [...without, b.chip.id] });
}

// Like btnPrimary / btnSecondary at btnMd, but a long chip label may wrap onto a second line
// instead of overflowing a phone screen.
const removeBase =
  "relative inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-5 py-2 text-center text-[15px] font-semibold";
const removeFirst = `${removeBase} bg-accent text-on-accent hover:bg-accent-ink`;
const removeOther = `${removeBase} border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink`;

/** The no-results page: each blocking filter, what it did, and a button that removes it. */
export function BlockerList({ blockers, ...link }: { blockers: ChipBlocker[] } & LinkProps) {
  return (
    <ul className="w-full max-w-md space-y-3 text-start">
      {blockers.map((b, i) => (
        <li key={b.chip.id} className="space-y-3 rounded-card border border-line bg-bg p-4">
          <p className="leading-relaxed text-ink">
            {whatBlocked(b)} {passesWithout(b.would_pass, "בלי הסינון הזה")}
          </p>
          <Link href={removeHref(b, link)} className={i === 0 ? removeFirst : removeOther}>
            <X aria-hidden className="size-[18px] shrink-0" />
            הסרת הסינון: {b.chip.label_he}
            <LinkPending />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Under 1-2 results: the one filter whose removal lets the most checked products through. */
export function BlockerHint({ blocker, ...link }: { blocker: ChipBlocker } & LinkProps) {
  return (
    <aside
      aria-label="סינון שמגביל את התוצאות"
      className="flex w-full max-w-2xl flex-col items-start gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm leading-relaxed text-muted">
        {passesWithout(blocker.would_pass, `בלי הסינון ״${blocker.chip.label_he}״`)}
      </p>
      <Link
        href={removeHref(blocker, link)}
        aria-label={`הסרת הסינון: ${blocker.chip.label_he}`}
        className={`${btnSecondary} relative min-h-11 shrink-0 px-4 text-sm`}
      >
        <X aria-hidden className="size-4 shrink-0" />
        הסרת הסינון
        <LinkPending />
      </Link>
    </aside>
  );
}
