// File access for the offline evaluation: snapshots, labels and reports under fixtures/snapshots.
// Reads and writes local files only (no network, no env).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildLabelBook, type LabelBook } from "./labels";
import { REPORT_FORMAT, type EvalReport } from "./report";
import { compareSnapshots, parseSnapshot, type Snapshot } from "./snapshot";

export const SNAPSHOT_DIR = "fixtures/snapshots";
export const LABELS_DIR = `${SNAPSHOT_DIR}/labels`;

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Snapshot files: every <id>.json in the directory except the run ledger and reports. */
export function snapshotFiles(dir = SNAPSHOT_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json" && !f.startsWith("report-"))
    .sort();
}

/** Every snapshot, validated, in report order (eval, example, live). */
export function loadSnapshots(dir = SNAPSHOT_DIR): Snapshot[] {
  return snapshotFiles(dir)
    .map((f) => parseSnapshot(readJson(`${dir}/${f}`), `${dir}/${f}`))
    .sort(compareSnapshots);
}

export interface LoadedLabels {
  book: LabelBook;
  files: string[];
  entries: number;
}

/** Every labels file (none yet is fine: the label metrics are then left out). */
export function loadLabels(dir = LABELS_DIR): LoadedLabels {
  if (!existsSync(dir)) return { book: new Map(), files: [], entries: 0 };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const book = buildLabelBook(
    files.map((f) => ({ fileId: f.replace(/\.json$/, ""), json: readJson(`${dir}/${f}`) })),
  );
  let entries = 0;
  for (const labels of book.values()) entries += labels.size;
  return { book, files: files.map((f) => `${dir}/${f}`), entries };
}

const REPORT_NAME = /^[a-z0-9][a-z0-9._+-]{0,79}$/i;

export function reportPath(name: string, dir = SNAPSHOT_DIR): string {
  if (!REPORT_NAME.test(name)) {
    throw new Error(`report name "${name}": letters, digits and . _ + - only (at most 80)`);
  }
  return `${dir}/report-${name}.json`;
}

const isFlat = (v: unknown) => v === null || typeof v !== "object";

/**
 * Pretty JSON that stays short and diffs well: a product line (an object with a title) and a list
 * of plain values each on one line.
 */
export function reportJson(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every(isFlat)) return JSON.stringify(value);
    return `[\n${value.map((v) => inner + reportJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    if ("title" in value && "id" in value) return JSON.stringify(value);
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return "{}";
    const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${reportJson(v, inner)}`);
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function writeReport(path: string, report: EvalReport): void {
  writeFileSync(path, `${reportJson(report)}\n`);
}

export function readReport(path: string): EvalReport {
  if (!existsSync(path)) throw new Error(`no report at ${path}`);
  const report = readJson(path) as Partial<EvalReport>;
  if (report.format !== REPORT_FORMAT || !Array.isArray(report.runs) || !report.runs.length) {
    throw new Error(`${path} is not a report of format ${REPORT_FORMAT} with a run`);
  }
  return report as EvalReport;
}
