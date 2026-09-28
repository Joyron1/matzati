// Buyer judgments of snapshot products (docs/search-quality-plan.md, "סט בדיקה"): one label per
// product and query. The plan asks for a person's judgment; the first set (2026-09-28, 3,419
// labels in fixtures/snapshots/labels/*.json) was written by agents judging as buyers from each
// title, category and price, and waits for the owner's review (docs/search-quality-wave-a.md).
// Every metric built on it is in-sample: the wave A ranking was tuned on the same labels. No model
// runs at eval time. Pure: parsing only, no I/O.
import { z } from "zod";

export const LABELS = ["exact", "reasonable", "weak", "wrong"] as const;
export type Label = (typeof LABELS)[number];

/** Exact and reasonable products are what the plan counts as a correct card or lead. */
export const isGoodLabel = (label: Label | null | undefined): boolean =>
  label === "exact" || label === "reasonable";

export interface LabelEntry {
  productId: string;
  label: Label;
  note: string;
}

/** Query id → product id → label. */
export type LabelBook = Map<string, Map<string, LabelEntry>>;

// "acceptable" is the plan appendix's word for "reasonable".
const labelSchema = z
  .string()
  .transform((s) =>
    s.trim().toLowerCase() === "acceptable" ? "reasonable" : s.trim().toLowerCase(),
  )
  .pipe(z.enum(LABELS));

// Product ids stay strings: 16-17 digits do not survive a JSON number.
const entrySchema = z.object({
  productId: z.string().regex(/^\d+$/, "a product id is a string of digits"),
  label: labelSchema,
  note: z.string().optional().default(""),
});

const entriesSchema = z.array(entrySchema);
const wrappedSchema = z.looseObject({
  id: z.string().optional(),
  queryId: z.string().optional(),
  labels: entriesSchema,
});
const byQuerySchema = z.record(z.string(), entriesSchema);

function parsed<T>(schema: z.ZodType<T>, json: unknown, fileId: string): T {
  const res = schema.safeParse(json);
  if (res.success) return res.data;
  const issue = res.error.issues[0];
  throw new Error(`labels ${fileId}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/**
 * The entries of one labels file by query id. `fileId` is the file name without ".json". A file
 * is one of:
 * - an array of entries, for the query named by the file (`<query id>.json`);
 * - `{ id?, queryId?, labels: [...] }`, for `id` (or `queryId`, else the file name);
 * - `{ "<query id>": [...], ... }`, several queries in one file.
 */
export function parseLabelFile(fileId: string, json: unknown): Map<string, LabelEntry[]> {
  if (Array.isArray(json)) return new Map([[fileId, parsed(entriesSchema, json, fileId)]]);
  if (typeof json === "object" && json !== null && "labels" in json) {
    const data = parsed(wrappedSchema, json, fileId);
    return new Map([[data.id ?? data.queryId ?? fileId, data.labels]]);
  }
  return new Map(Object.entries(parsed(byQuerySchema, json, fileId)));
}

/**
 * Merges parsed files into one book. The same product labelled twice for one query must agree:
 * a conflict throws, so a labelling mistake is seen instead of silently picking one.
 */
export function buildLabelBook(files: { fileId: string; json: unknown }[]): LabelBook {
  const book: LabelBook = new Map();
  for (const { fileId, json } of files) {
    for (const [queryId, entries] of parseLabelFile(fileId, json)) {
      const labels = book.get(queryId) ?? new Map<string, LabelEntry>();
      for (const e of entries) {
        const prior = labels.get(e.productId);
        if (prior && prior.label !== e.label) {
          throw new Error(
            `labels ${fileId}: ${queryId} ${e.productId} is both "${prior.label}" and "${e.label}"`,
          );
        }
        if (!prior) labels.set(e.productId, e);
      }
      book.set(queryId, labels);
    }
  }
  return book;
}

/**
 * The labels of a snapshot: its own, else those of the snapshot it copies (`sameQueryAs`: the same
 * query, so the same judgments apply). Null when neither has labels.
 */
export function labelsFor(
  book: LabelBook,
  snap: { id: string; sameQueryAs: string | null },
): Map<string, LabelEntry> | null {
  return book.get(snap.id) ?? (snap.sameQueryAs ? book.get(snap.sameQueryAs) : undefined) ?? null;
}

/** One letter per label for tables: E exact, R reasonable, w weak, X wrong, ? unlabelled. */
export function labelLetter(label: Label | null | undefined): string {
  switch (label) {
    case "exact":
      return "E";
    case "reasonable":
      return "R";
    case "weak":
      return "w";
    case "wrong":
      return "X";
    default:
      return "?";
  }
}
