// The admin's write of a setting (service role). Call it from a server action only: it checks
// requireAdmin() itself (an action is reachable by a direct POST), validates the value with zod
// right before the write, and expires SETTINGS_TAG with updateTag, which Next allows in server
// actions only, so the next search reads the new value.
import "server-only";
import { updateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { ShopCapMode } from "@/lib/ranking/config";
import { serviceClient } from "@/lib/supabase/server";
import { upsertSetting } from "./db";
import { SETTINGS_TAG, SHOP_CAP_KEY, shopCapValueSchema } from "./schema";

/**
 * Saves the shop cap mode and expires the cached reads. Throws on an invalid value (ZodError) or a
 * failed write (SettingsDbError); redirects to the login when the caller is not an admin.
 */
export async function saveShopCapMode(input: unknown): Promise<ShopCapMode> {
  await requireAdmin();
  const value = shopCapValueSchema.parse(input);
  await upsertSetting(serviceClient(), SHOP_CAP_KEY, value);
  updateTag(SETTINGS_TAG);
  return value.mode;
}
