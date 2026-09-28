// Queries against public.site_settings, taking the Supabase client as a parameter so they can be
// tested with a fake. The service role only: the table has RLS on and no policies.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const SETTINGS_TABLE = "site_settings";

/** A settings read or write failed. The message names the operation, never a value. */
export class SettingsDbError extends Error {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`site_settings ${operation} failed`, options);
    this.name = "SettingsDbError";
  }
}

export type SettingsClient = Pick<SupabaseClient, "from">;

const rowSchema = z.object({ value: z.unknown(), updated_at: z.string() });

export interface StoredSetting {
  value: unknown;
  updatedAt: string;
}

/** The stored value of `key`, or null when there is no row. Throws SettingsDbError. */
export async function selectSetting(
  db: SettingsClient,
  key: string,
): Promise<StoredSetting | null> {
  const { data, error } = await db
    .from(SETTINGS_TABLE)
    .select("value, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new SettingsDbError("select", { cause: error });
  if (data === null) return null;
  const row = rowSchema.safeParse(data);
  if (!row.success) throw new SettingsDbError("select (row shape)");
  return { value: row.data.value, updatedAt: row.data.updated_at };
}

const keyedRowSchema = rowSchema.extend({ key: z.string() });

/**
 * The stored values of `keys` in one query, by key; a key without a row is absent from the map.
 * Throws SettingsDbError.
 */
export async function selectSettings(
  db: SettingsClient,
  keys: readonly string[],
): Promise<Map<string, StoredSetting>> {
  const { data, error } = await db
    .from(SETTINGS_TABLE)
    .select("key, value, updated_at")
    .in("key", [...keys]);
  if (error) throw new SettingsDbError("select", { cause: error });
  const rows = z.array(keyedRowSchema).safeParse(data ?? []);
  if (!rows.success) throw new SettingsDbError("select (row shape)");
  return new Map(rows.data.map((r) => [r.key, { value: r.value, updatedAt: r.updated_at }]));
}

/** Stores `value` under `key` (updated_at is set by the database). Throws SettingsDbError. */
export async function upsertSetting(
  db: SettingsClient,
  key: string,
  value: unknown,
): Promise<void> {
  const { error } = await db.from(SETTINGS_TABLE).upsert({ key, value }, { onConflict: "key" });
  if (error) throw new SettingsDbError("upsert", { cause: error });
}

/** Stores several settings in one statement (all or none). Throws SettingsDbError. */
export async function upsertSettings(
  db: SettingsClient,
  rows: readonly { key: string; value: unknown }[],
): Promise<void> {
  const { error } = await db.from(SETTINGS_TABLE).upsert([...rows], { onConflict: "key" });
  if (error) throw new SettingsDbError("upsert", { cause: error });
}
