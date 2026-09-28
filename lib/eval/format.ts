// Plain-text tables for scripts/eval-offline.ts. Ids and numbers only: the Hebrew queries are in the
// JSON report, since mixed-direction text breaks column alignment in a terminal.
import { labelLetter } from "./labels";
import type { Comparison, EvalRun } from "./report";
import { totalsOf } from "./report";
import type { ProductLine, QueryResult } from "./replay";

const STEP_SHORT: Record<string, string> = { "primary-p1": "p1", "primary-p2": "p2" };

/** "primary-p1" → "p1", "ladder-2" → "L2". */
export function shortStep(step: string): string {
  return STEP_SHORT[step] ?? step.replace(/^ladder-/, "L");
}

/** A column: name, width, and "r" for right-aligned numbers (text is left-aligned). */
type Column = [string, number, ("l" | "r")?];

function table(header: Column[], rows: string[][]): string {
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (header[i][2] === "r" ? c.padStart(header[i][1]) : c.padEnd(header[i][1])))
      .join("  ")
      .trimEnd();
  const head = line(header.map(([name]) => name));
  return [head, "-".repeat(head.length), ...rows.map(line)].join("\n");
}

function fetchCell(r: QueryResult): string {
  const steps = r.fetch.steps.map(shortStep).join(",");
  return r.fetch.missing ? `${steps || "-"} +missing` : steps || "-";
}

function topCell(r: QueryResult): string {
  if (!r.labels) return r.top3.length ? "-".repeat(r.top3.length) : "";
  return r.top3.map((l) => labelLetter(l.label)).join("");
}

function leadCell(r: QueryResult): string {
  if (!r.labels || r.labels.leadCorrect === null) return "-";
  return r.labels.leadCorrect ? "yes" : "NO";
}

/** One row per query, then the totals. */
export function formatRun(run: EvalRun): string {
  const header: Column[] = [
    ["id", 22],
    ["parse", 5],
    ["calls", 16],
    ["chk", 4, "r"],
    ["pass", 4, "r"],
    ["fill", 4, "r"],
    ["top3", 4],
    ["lead", 4],
    ["shop", 4, "r"],
    ["more", 4],
    ["notes", 0],
  ];
  const rows = run.queries.map((r) => [
    r.id,
    `v${r.parseVersion}`,
    fetchCell(r),
    String(r.checked),
    String(r.passed),
    String(r.fill),
    topCell(r),
    leadCell(r),
    r.shown ? String(r.sameShopTop3) : "-",
    r.moreAvailable ? "yes" : "no",
    [
      r.error ?? "",
      r.fetch.missing ? `missing ${r.fetch.missing}` : "",
      r.sameQueryAs ? `= ${r.sameQueryAs}` : "",
      r.labels?.wrongTop3 ? `${r.labels.wrongTop3} wrong` : "",
    ]
      .filter(Boolean)
      .join("; "),
  ]);
  const v = run.variant;
  const extras = [
    v.sort ? `sort ${v.sort}` : "",
    v.without.length ? `without ${v.without.join(",")}` : "",
    v.adjustedParse ? "adjusted parse" : "",
    v.rank === "custom" ? "custom ranking" : "",
  ].filter(Boolean);
  const title = `== ${v.name}: ${v.policyDescription}${extras.length ? ` (${extras.join("; ")})` : ""}`;
  return [title, table(header, rows), "", formatTotals(run)].join("\n");
}

export function formatTotals(run: EvalRun): string {
  const s = run.summary;
  const t = totalsOf(s);
  const lines = Object.entries(t)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `  ${k.padEnd(27)} ${v}`);
  const lists: [string, string[]][] = [
    ["incomplete", s.incomplete],
    ["no results", s.noResults],
    ["1-2 results", s.underOnePage],
    ["exactly 3", s.exactlyOnePage],
    ["2+ same shop", s.sameShopTop3],
    ["errors", s.errors],
  ];
  for (const [name, ids] of lists) if (ids.length) lines.push(`  ${name}: ${ids.join(", ")}`);
  if (s.labels.queries) {
    lines.push(
      `  labels: ${s.labels.queries} queries, ${s.labels.cardsLabelled} of ${s.labels.cardsShown} shown cards labelled, ` +
        `${s.labels.unlabelledTop6} top-6 products unlabelled` +
        (s.labels.unknownIds ? `, ${s.labels.unknownIds} labelled ids not in their snapshot` : ""),
    );
  } else {
    lines.push("  labels: none (fixtures/snapshots/labels/*.json)");
  }
  return `Totals (${s.queries} queries, ${s.copies} copies of another query):\n${lines.join("\n")}`;
}

function productRow(rank: number, l: ProductLine): string {
  const fb = l.feedbackPct === null ? "-" : `${l.feedbackPct}%`;
  return (
    `  ${String(rank).padStart(2)} ${labelLetter(l.label)} ${l.id} ${l.tier === "fill" ? "fill" : "std "} ` +
    `${`₪${l.price.toFixed(2)}`.padStart(8)} ${fb.padStart(6)} ${String(l.unitsSold ?? "-").padStart(6)} ` +
    `shop ${(l.shop ?? "-").padEnd(10)} ${l.title.slice(0, 70)}`
  );
}

/** The first two pages of every query, for reading results and choosing what to label. */
export function formatDetail(run: EvalRun): string {
  return run.queries
    .map((r) => {
      const head = `${r.id} (${r.query}): passed ${r.passed} of ${r.checked} checked`;
      const rows = [...r.top3, ...r.next3].map((l, i) => productRow(i + 1, l));
      return [head, ...(rows.length ? rows : ["  (no results)"])].join("\n");
    })
    .join("\n\n");
}

export function formatComparison(c: Comparison & { source?: string }): string {
  const title = `== ${c.baseline} → ${c.candidate}${c.source ? ` (${c.source})` : ""}: ${c.queries.length} queries changed, ${c.unchanged} unchanged`;
  const rows = c.queries.map((q) => `  ${q.id.padEnd(22)} ${q.changes.join("; ")}`);
  const width = Math.max(
    ...c.totals.flatMap((t) => [
      String(t.baseline ?? "-").length,
      String(t.candidate ?? "-").length,
    ]),
    c.baseline.length,
    c.candidate.length,
  );
  const totals = c.totals
    .filter((t) => t.baseline !== null || t.candidate !== null)
    .map((t) => {
      const a = String(t.baseline ?? "-");
      const b = String(t.candidate ?? "-");
      return `  ${t.metric.padEnd(27)} ${a.padStart(width)}  ${b.padStart(width)}${a === b ? "" : "  *"}`;
    });
  return [
    title,
    ...(rows.length ? rows : ["  (no query changed)"]),
    "",
    `  ${"total".padEnd(27)} ${c.baseline.padStart(width)}  ${c.candidate.padStart(width)}`,
    ...totals,
  ].join("\n");
}
