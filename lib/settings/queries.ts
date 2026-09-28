// Reads of the owner settings (public.site_settings) with the service role. The search reads the
// shop cap once per request through a 5-minute cache under SETTINGS_TAG, which the admin's save
// expires (./admin.ts), and falls back to the default on any failure: a settings hiccup never
// fails a search. /admin/settings reads fresh.
import "server-only";
import { unstable_cache } from "next/cache";
import { DEFAULT_SHOP_CAP_MODE, type ShopCapMode } from "@/lib/ranking/config";
import { serviceClient } from "@/lib/supabase/server";
import { selectSetting } from "./db";
import { SETTINGS_TAG, SHOP_CAP_KEY, shopCapModeOf, type ShopCapSetting } from "./schema";

/** Seconds a read is reused before the next one reads the table again. */
const REVALIDATE_SECONDS = 300;
/**
 * After a failed read (the table is missing, the database is down), this instance uses the
 * default for this long without trying again, so a search does not wait for a failing read each
 * time and the log gets one line a minute, not one per search.
 */
const FAILURE_PAUSE_MS = 60_000;

function logError(where: string, err: unknown) {
  // Name and message only: never a stored value.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[settings] ${where}: ${text.slice(0, 300)}`);
}

/**
 * The stored shop cap setting. A value this code does not know reads as the default (logged); a
 * failed read throws, so it is never cached.
 */
async function readShopCap(): Promise<ShopCapSetting> {
  const row = await selectSetting(serviceClient(), SHOP_CAP_KEY);
  if (!row) return { mode: DEFAULT_SHOP_CAP_MODE, stored: false, updatedAt: null };
  const mode = shopCapModeOf(row.value);
  if (mode === null) logError("shop cap", new Error("stored value is not a known mode"));
  return { mode: mode ?? DEFAULT_SHOP_CAP_MODE, stored: mode !== null, updatedAt: row.updatedAt };
}

// Errors are thrown inside, so a failure is never cached.
const cachedShopCapMode = unstable_cache(
  async (): Promise<ShopCapMode> => (await readShopCap()).mode,
  ["settings-shop-cap"],
  { revalidate: REVALIDATE_SECONDS, tags: [SETTINGS_TAG] },
);

let failedAt: number | null = null;

/**
 * The shop cap mode the search ranks under (lib/search/server.ts, once per request): the admin's
 * setting, cached 5 minutes, or DEFAULT_SHOP_CAP_MODE when it cannot be read. Never throws.
 */
export async function shopCapMode(): Promise<ShopCapMode> {
  if (failedAt !== null && Date.now() - failedAt < FAILURE_PAUSE_MS) return DEFAULT_SHOP_CAP_MODE;
  try {
    const mode = await cachedShopCapMode();
    failedAt = null;
    return mode;
  } catch (err) {
    failedAt = Date.now();
    logError("shop cap", err);
    return DEFAULT_SHOP_CAP_MODE;
  }
}

/** The setting as /admin/settings shows it, read fresh; null when it cannot be read (logged). */
export async function shopCapSettingForAdmin(): Promise<ShopCapSetting | null> {
  try {
    return await readShopCap();
  } catch (err) {
    logError("admin read", err);
    return null;
  }
}
