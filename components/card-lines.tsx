"use client";

import { Suspense, use } from "react";
import { hasHebrew } from "@/lib/product-title";
import type { LoggedResult } from "@/lib/search-url";

// The title and "why we picked it" line of a result card while they are being written (plan item
// 15): the card shows AliExpress's title at once and, where the line will be, that it is being
// written; the finished title and line take their place, in the same box, once the explain call is
// done. Streamed with the page (Suspense and use(), swapped in by React's inline scripts before the
// page's JavaScript bundle loads). /search needs JavaScript anyway: its results stream in the same
// way.

/** The finished results of the first page, or null when they could not be finished. */
export type FinalResults = Promise<LoggedResult[] | null>;

/** Where a card's line will be, until it is written. */
export const WRITING_LINE = "כותבים משפט קצר על המוצר…";

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * A card title. Without a Hebrew title of ours (not written yet, or rejected) it is AliExpress's
 * English title: laid out left to right as a block of its own (lang en, so a screen reader reads it
 * with an English voice), so a clamp cuts it at its own end, not its start, and aligned to the end
 * of its lines, the right edge the Hebrew column shares. `clamp`: at most two lines.
 */
export function TitleText({ title, clamp = false }: { title: string; clamp?: boolean }) {
  if (hasHebrew(title)) {
    return clamp ? <span className="line-clamp-2">{title}</span> : title;
  }
  return (
    <span dir="ltr" lang="en" className={cx("text-end", clamp ? "line-clamp-2" : "block")}>
      {title}
    </span>
  );
}

type Field = "title_he" | "why_he";

interface LineProps {
  final: FinalResults;
  id: string;
  field: Field;
  /** What the card shows until then: AliExpress's title, or the line built from the data. */
  interim: string;
  /** Titles only: at most two lines (TitleText). */
  clamp?: boolean;
}

function Finished({ final, id, field, interim, clamp }: LineProps) {
  const done = use(final);
  // Without finished results (the explain call failed), the interim title and data line stay.
  const text = done?.find((r) => r.product_id === id)?.[field] || interim;
  return field === "title_he" ? <TitleText title={text} clamp={clamp} /> : text;
}

/**
 * A line being written: the words, and one bar per line of the room kept for it (the room the
 * card reserves, so nothing moves when the line comes). The bars are decoration.
 */
function Writing({ bars }: { bars: 1 | 2 | 3 }) {
  return (
    <>
      {WRITING_LINE}
      {[0, 1, 2].slice(0, bars).map((i) => (
        <span
          key={i}
          aria-hidden
          // The second and third bars fill the lines phones keep; from sm the room is two lines.
          className={cx("flex h-[1lh] items-center", i > 0 && "sm:hidden")}
        >
          <span
            className={cx(
              "h-2 rounded-full bg-current opacity-15 motion-safe:animate-pulse",
              i === 1 ? "w-3/5" : "w-4/5",
            )}
          />
        </span>
      ))}
    </>
  );
}

/**
 * `field` of product `id`: until `final` brings the finished one, AliExpress's title (titles) or
 * the "being written" placeholder with `bars` placeholder lines (lines). `interim` is kept for a
 * search whose explain call failed.
 */
export function StreamedLine({
  bars = 1,
  ...props
}: LineProps & {
  /** Lines only: how many placeholder bars fill the room kept for the line. */
  bars?: 1 | 2 | 3;
}) {
  const fallback =
    props.field === "title_he" ? (
      <TitleText title={props.interim} clamp={props.clamp} />
    ) : (
      <Writing bars={bars} />
    );
  return (
    <Suspense fallback={fallback}>
      <Finished {...props} />
    </Suspense>
  );
}
