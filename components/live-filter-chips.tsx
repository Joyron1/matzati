"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { FilterChips } from "./filter-chips";

/**
 * The "הבנתי ככה" chips of a results page that shows them before its products (plan item 15): the
 * chip to draw attention to (the filter that kept everything out) is known only with the products,
 * so it lights up then, on the same row, which does not move.
 */
export function LiveFilterChips({
  highlight,
  ...props
}: Omit<ComponentProps<typeof FilterChips>, "highlightIds"> & { highlight: Promise<string[]> }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void highlight.then((next) => {
      if (live) setIds(next);
    });
    return () => {
      live = false;
    };
  }, [highlight]);
  return <FilterChips {...props} highlightIds={ids} />;
}
