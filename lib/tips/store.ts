// category_tips (CLAUDE.md §8) through the service-role client: generic buying tips per AliExpress
// category, written by lib/tips/refresh.ts. tips_he holds { v: TIPS_VERSION, category_en, tips }.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MIN_TIPS, TIPS_VERSION } from "@/lib/llm/tips";
import { serviceClient } from "@/lib/supabase/server";

/** Entries older than this are regenerated (they are still shown until then). */
export const TIPS_MAX_AGE_MS = 30 * 24 * 3_600_000;

const storedTipsSchema = z.object({
  v: z.number().int(),
  category_en: z.string(),
  tips: z.array(z.string()),
});

/** The tips_he column. */
export type StoredTips = z.infer<typeof storedTipsSchema>;

export interface TipsEntry {
  categoryId: string;
  categoryEn: string;
  /** Empty when the model could not write enough tips that passed the checks. */
  tips: string[];
  version: number;
  updatedAt: string;
  /** Older than 30 days or written by another TIPS_VERSION: regenerate it. */
  stale: boolean;
}

/** The database could not be read or written. */
export class TipsStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TipsStoreError";
  }
}

export function isStale(version: number, updatedAt: string, now: Date): boolean {
  const written = Date.parse(updatedAt);
  return (
    version !== TIPS_VERSION ||
    !Number.isFinite(written) ||
    now.getTime() - written >= TIPS_MAX_AGE_MS
  );
}

/**
 * The stored entry, or null when there is none (or the row is malformed, which the next refresh
 * overwrites). Throws TipsStoreError when the database fails, so callers can tell "no tips yet"
 * from "cannot read" and do not pay for tips they may already have.
 */
export async function readCategoryTips(
  categoryId: string,
  now: Date,
  db: SupabaseClient = serviceClient(),
): Promise<TipsEntry | null> {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await db
      .from("category_tips")
      .select("tips_he, updated_at")
      .eq("category_id", categoryId)
      .maybeSingle();
  } catch (err) {
    throw new TipsStoreError(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (result.error) throw new TipsStoreError(`read failed: ${result.error.message}`);
  const row = result.data as { tips_he?: unknown; updated_at?: unknown } | null;
  if (!row || typeof row.updated_at !== "string") return null;
  const parsed = storedTipsSchema.safeParse(row.tips_he);
  if (!parsed.success) return null;
  const { v, category_en, tips } = parsed.data;
  return {
    categoryId,
    categoryEn: category_en,
    tips,
    version: v,
    updatedAt: row.updated_at,
    stale: isStale(v, row.updated_at, now),
  };
}

/** Tips a page may show: the current version's list, even when it is due for a refresh. */
export function displayableTips(entry: TipsEntry | null): string[] | null {
  if (!entry || entry.version !== TIPS_VERSION || entry.tips.length < MIN_TIPS) return null;
  return entry.tips;
}

/** Inserts or replaces the entry. Throws TipsStoreError when the database fails. */
export async function writeCategoryTips(
  categoryId: string,
  entry: { categoryEn: string; tips: string[] },
  now: Date,
  db: SupabaseClient = serviceClient(),
): Promise<void> {
  const tipsHe: StoredTips = { v: TIPS_VERSION, category_en: entry.categoryEn, tips: entry.tips };
  let error: { message: string } | null;
  try {
    ({ error } = await db
      .from("category_tips")
      .upsert(
        { category_id: categoryId, tips_he: tipsHe, updated_at: now.toISOString() },
        { onConflict: "category_id" },
      ));
  } catch (err) {
    throw new TipsStoreError(`write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (error) throw new TipsStoreError(`write failed: ${error.message}`);
}
