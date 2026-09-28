"use client";

import { useEffect, useState } from "react";
import type { LoggedResult } from "@/lib/search-url";
import type { FinalResults } from "./card-lines";
import { CompactProductCard, FeaturedProductCard } from "./product-cards";

/** Said once, politely, when the lines streamed in (plan item 15). */
export const LINES_ARRIVED = "הוספנו לכל מוצר משפט קצר על הסיבה שבחרנו בו.";
/**
 * Added when the finished order differs: only the safety net changes it (a first-page product
 * whose line says it is another product moves down, lib/ranking/featured-guard.ts).
 */
export const ORDER_CHANGED = "מוצר שלא התאים לחיפוש ירד מהעמוד הראשון, והסדר התעדכן.";

const order = (results: readonly LoggedResult[]) => results.map((r) => r.product_id).join(",");

/** True when the finished results say something the first ones did not (a title or a line). */
export function linesArrived(first: readonly LoggedResult[], done: readonly LoggedResult[]) {
  const before = new Map(first.map((r) => [r.product_id, r]));
  return done.some((r) => {
    const was = before.get(r.product_id);
    return !was || was.title_he !== r.title_he || was.why_he !== r.why_he;
  });
}

/** What a screen reader hears when the finished results replace the first ones ("" for nothing). */
export function finishedAnnouncement(
  first: readonly LoggedResult[],
  done: readonly LoggedResult[],
): string {
  const said = [];
  if (linesArrived(first, done)) said.push(LINES_ARRIVED);
  if (order(done) !== order(first)) said.push(ORDER_CHANGED);
  return said.join(" ");
}

/**
 * The first page of results on /search: the featured card and the two compact ones. While their
 * lines are being written (`final`), the cards show what they have and keep room for the lines,
 * which take its place when they come (./card-lines.tsx); a screen reader hears once that they
 * came. The finished results then replace the first ones everywhere on the cards (the image alt
 * too), and when the safety net moved a first-page product down on reading its line
 * (lib/ranking/featured-guard.ts), their order too, which is said as well.
 */
export function ResultCards({
  initial,
  final,
  q,
}: {
  initial: LoggedResult[];
  final?: FinalResults;
  q: string;
}) {
  const [results, setResults] = useState(initial);
  const [said, setSaid] = useState("");

  useEffect(() => {
    if (!final) return;
    let live = true;
    void final.then((done) => {
      if (!live || !done?.length) return;
      setResults(done);
      const text = finishedAnnouncement(initial, done);
      if (text) setSaid(text);
    });
    return () => {
      live = false;
    };
  }, [final, initial]);

  const [top, ...rest] = results;
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <FeaturedProductCard product={top} rank={1} q={q} final={final} />
        {rest.length > 0 && (
          <div className="grid gap-5">
            {rest.map((p, i) => (
              <CompactProductCard key={p.product_id} product={p} rank={i + 2} q={q} final={final} />
            ))}
          </div>
        )}
      </div>
      <p role="status" className="sr-only">
        {said}
      </p>
    </>
  );
}
