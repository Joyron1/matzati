// Small building blocks for /admin/stats: a titled section, an accessible scrollable table and
// its empty and error rows. Server components, no chart library: numbers in plain tables.
import type { ReactNode } from "react";
import { card } from "@/components/styles";

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="space-y-1">
        <h2 id={id} className="font-display text-2xl">
          {title}
        </h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * A table in a keyboard-scrollable region (wide tables scroll inside it on a phone, never the
 * page). `caption` names the table for screen readers; the section heading is the visible name.
 * The region is `relative` so sr-only text inside it is positioned and clipped here: otherwise, in
 * RTL, its static position lands off-screen to the left and the whole page scrolls sideways.
 */
export function DataTable({
  labelledBy,
  caption,
  head,
  children,
  foot,
}: {
  labelledBy: string;
  caption: string;
  head: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={`${card} relative overflow-x-auto`}
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2/60">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
        {foot && <tfoot className="border-t-2 border-line font-bold">{foot}</tfoot>}
      </table>
    </div>
  );
}

const cell = "px-3 py-2.5 align-middle sm:px-4";

/** Column header. Numeric columns align to the end, like the numbers under them. */
export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`${cell} font-semibold whitespace-nowrap text-muted ${numeric ? "text-end" : "text-start"}`}
    >
      {children}
    </th>
  );
}

/** Row header (the first cell that names the row). */
export function RowTh({ children }: { children: ReactNode }) {
  return (
    <th scope="row" className={`${cell} text-start font-semibold whitespace-nowrap`}>
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  muted,
  wrap,
}: {
  children: ReactNode;
  numeric?: boolean;
  muted?: boolean;
  /** Long text (queries, titles) may wrap; numbers never do. */
  wrap?: boolean;
}) {
  return (
    <td
      className={`${cell} ${numeric ? "text-end whitespace-nowrap" : "text-start"} ${
        wrap ? "min-w-48 break-words" : "whitespace-nowrap"
      } ${muted ? "text-muted" : ""}`}
    >
      {children}
    </td>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line last:border-b-0">{children}</tr>;
}

/** Shown instead of a table when a part has no rows or could not be loaded. */
export function Notice({ children }: { children: ReactNode }) {
  return <p className={`${card} px-5 py-4 text-muted`}>{children}</p>;
}

export const LOAD_FAILED = "לא הצלחנו לטעון את החלק הזה. נסו לרענן את הדף בעוד רגע.";
