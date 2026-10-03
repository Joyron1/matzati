import Link from "next/link";
import { Compass, LayoutGrid, X } from "lucide-react";
import { formatCount } from "@/lib/format";
import { searchHref } from "@/lib/search-url";
import type { GeneralTip, RemovalTip, SearchHelp } from "@/lib/search/help-tips";
import type { SortPreference } from "@/lib/types";
import { LinkPending } from "./pending-navigation";
import { btnSecondary } from "./styles";

// Help when a search finds little (owner request 2026-10-03): under fewer results than the first
// view, and inside the no-results card. The tips come from lib/search/help-tips.ts (the search's own
// chips and blockers); a number is shown only where the blockers counted it.

interface LinkProps {
  q: string;
  sort?: SortPreference;
  without: string[];
  /** The category the search is limited to, kept by a removal. */
  cat?: string;
}

const GENERAL_COPY: Record<GeneralTip, string> = {
  simpler_words: "כתבו את סוג המוצר במילים פשוטות, בלי שם דגם או פרטים מיותרים.",
  synonym: "נסו מילה נרדפת, למשל ״תרמיל״ במקום ״תיק גב״.",
  spelling: "בדקו את האיות של המילים.",
};

/** The help's own heading: how many passed (only for some results), said as the visitor sees it. */
export function fewResultsTitle(shown: number): string {
  return shown === 1
    ? "מצאנו רק מוצר אחד שעבר את הסינון"
    : `מצאנו רק ${formatCount(shown)} מוצרים שעברו את הסינון`;
}

function removalText(tip: RemovalTip) {
  switch (tip.kind) {
    case "blocker":
      return tip.wouldPass === 1 ? (
        <>בלי ״{tip.chip.label_he}״ היה עובר מוצר אחד מהמוצרים שכבר בדקנו.</>
      ) : (
        <>
          בלי ״{tip.chip.label_he}״ היו עוברים <bdi dir="ltr">{formatCount(tip.wouldPass)}</bdi>{" "}
          מהמוצרים שכבר בדקנו.
        </>
      );
    case "price":
      return <>נסו תקציב רחב יותר, או חפשו בלי הגבלת מחיר.</>;
    case "requirement":
      return <>נסו לחפש בלי ״{tip.chip.label_he}״.</>;
  }
}

function removalLink(tip: RemovalTip, { q, sort, without, cat }: LinkProps) {
  const chips = tip.kind === "price" ? tip.chips : [tip.chip];
  const label = chips.length === 1 ? `חיפוש בלי ״${chips[0].label_he}״` : "חיפוש בלי סינון המחיר";
  return (
    <Link
      href={searchHref({ q, sort, without: [...without, ...chips.map((c) => c.id)], cat })}
      className={`${btnSecondary} relative min-h-11 shrink-0 px-4 text-sm whitespace-normal! text-center`}
    >
      <X aria-hidden className="size-4 shrink-0" />
      {label}
      <LinkPending />
    </Link>
  );
}

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent-ink underline underline-offset-4 hover:text-ink";

/**
 * The tips: filters to remove (each with a link to the search without it), ways to write the search
 * again, and links to all products (/products) and the search ideas. `heading` names the box (a real
 * heading).
 */
export function SearchHelpBox({
  help,
  heading,
  headingLevel = 2,
  className = "",
  ...link
}: LinkProps & {
  help: SearchHelp;
  heading: string;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const { removals } = help;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby="search-help-title"
      className={`w-full max-w-2xl space-y-3 rounded-card border border-line bg-surface p-4 text-start text-sm leading-relaxed ${className}`}
    >
      <Heading id="search-help-title" className="text-base font-bold text-ink">
        {heading}
      </Heading>
      {removals.length > 0 && (
        <ul className="space-y-2">
          {removals.map((tip) => (
            <li
              key={tip.kind === "price" ? "price" : tip.chip.id}
              className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-ink">{removalText(tip)}</p>
              {removalLink(tip, link)}
            </li>
          ))}
        </ul>
      )}
      <ul className="list-disc space-y-1 ps-5 text-muted">
        {help.general.map((g) => (
          <li key={g}>{GENERAL_COPY[g]}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-5">
        <Link href="/products" className={linkClass}>
          <LayoutGrid aria-hidden className="size-4 shrink-0" />
          לכל המוצרים
        </Link>
        <Link href="/#ideas-title" className={linkClass}>
          <Compass aria-hidden className="size-4 shrink-0" />
          לרעיונות לחיפוש
        </Link>
      </div>
    </section>
  );
}
