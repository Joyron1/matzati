// The product-pool snapshots of scripts/snapshot-pools.ts (fixtures/snapshots/<id>.json), read for
// offline replay (docs/search-quality-plan.md, item 1). Pure: parsing only, no I/O.
import { z } from "zod";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { ParsedQuery } from "@/lib/search/filters";

/** The snapshot file format this reader understands (`format` in each file). */
export const SNAPSHOT_FORMAT = 1;

export type SnapshotGroup = "eval" | "example" | "live";

/** One captured product.query call, with every product it returned in AliExpress's order. */
export interface SnapshotCall {
  /** "primary-p1", "primary-p2", "ladder-1", ... */
  step: string;
  keywords: string;
  pageNo: number;
  pageSize: number;
  sort: string;
  minPriceIls: number | null;
  maxPriceIls: number | null;
  /** Items AliExpress returned, before validation. */
  rawCount: number;
  /** Items that passed productSchema: the products below. */
  parsedCount: number;
  totalRecords: number | null;
  error: string | null;
  products: AliProduct[];
}

export interface Snapshot {
  format: number;
  id: string;
  group: SnapshotGroup;
  query: string;
  /** Another snapshot with the same normalized query, whose calls this one copies. */
  sameQueryAs: string | null;
  capturedAt: string;
  parse: { source: string; parseVersion: number; parsed: ParsedQuery };
  calls: SnapshotCall[];
}

// Only the fields replay and ranking read are checked; the rest of each product is the normalized
// AliProduct snapshot-pools.ts saved (promotionLink is a marker string or null), kept as is.
const productSchema = z.looseObject({
  productId: z.string().regex(/^\d+$/),
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  discountPct: z.number().nullable(),
  positiveFeedbackPct: z.number().nullable(),
  unitsSold: z.number().nullable(),
  promotionLink: z.string().nullable(),
  commissionRatePct: z.number().nullable(),
  shop: z.looseObject({ id: z.string().nullable() }),
  category: z.looseObject({ firstId: z.string().nullable(), secondName: z.string().nullable() }),
});

// Loose, so fields a later parse contract adds reach the ranking code unchanged.
const parsedSchema = z.looseObject({
  keywords_en: z.string(),
  product_terms: z.array(z.string()),
  requirements: z.array(z.object({ en: z.string(), alt: z.array(z.string()), he: z.string() })),
  min_price_ils: z.number().optional(),
  max_price_ils: z.number().optional(),
  sort_preference: z.enum(["best_value", "cheapest", "most_popular"]),
  product_he: z.string(),
  category_hint: z.string().optional(),
});

const callSchema = z.object({
  step: z.string(),
  keywords: z.string(),
  pageNo: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  sort: z.string(),
  minPriceIls: z.number().nullable(),
  maxPriceIls: z.number().nullable(),
  rawCount: z.number().int().nonnegative(),
  parsedCount: z.number().int().nonnegative(),
  totalRecords: z.number().nullable(),
  error: z.string().nullable(),
  products: z.array(productSchema),
});

const snapshotSchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  id: z.string().min(1),
  group: z.enum(["eval", "example", "live"]),
  query: z.string().min(1),
  sameQueryAs: z.string().nullable(),
  capturedAt: z.string(),
  parse: z.object({ source: z.string(), parseVersion: z.number(), parsed: parsedSchema }),
  calls: z.array(callSchema),
});

/** Validates one snapshot file's JSON; throws with the path of the first bad field. */
export function parseSnapshot(json: unknown, file = "snapshot"): Snapshot {
  const res = snapshotSchema.safeParse(json);
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new Error(`${file}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  // The checked fields match AliProduct and ParsedQuery; the loose rest is theirs as saved.
  return res.data as unknown as Snapshot;
}

/** Distinct products in call order, first occurrence wins (the pipeline's `seen` map). */
export function distinctProducts(calls: readonly Pick<SnapshotCall, "products">[]): AliProduct[] {
  const seen = new Map<string, AliProduct>();
  for (const c of calls)
    for (const p of c.products) if (!seen.has(p.productId)) seen.set(p.productId, p);
  return [...seen.values()];
}

/** Identity of a product.query call as the replay matches it: keywords, page and price bounds. */
export function callKey(
  keywords: string,
  pageNo: number,
  minPriceIls: number | null | undefined,
  maxPriceIls: number | null | undefined,
): string {
  return JSON.stringify([keywords, pageNo, minPriceIls ?? null, maxPriceIls ?? null]);
}

const GROUP_ORDER: Record<SnapshotGroup, number> = { eval: 0, example: 1, live: 2 };

/** Stable report order: eval, example, live; ids in natural order within a group (ex-2 < ex-10). */
export function compareSnapshots(a: Snapshot, b: Snapshot): number {
  return (
    GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.id.localeCompare(b.id, "en", { numeric: true })
  );
}
