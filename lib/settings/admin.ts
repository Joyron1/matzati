// The admin's writes of the settings (service role). Call them from server actions only: each
// checks requireAdmin() itself (an action is reachable by a direct POST), validates the value
// with zod right before the write, and expires SETTINGS_TAG with updateTag, which Next allows in
// server actions only, so the next search and the next page render read the new value.
import "server-only";
import { updateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import type { ShopCapMode } from "@/lib/ranking/config";
import { serviceClient } from "@/lib/supabase/server";
import { COMMUNITY_KEY, communityValueSchema, type CommunityValue } from "./community-link";
import { upsertSetting, upsertSettings } from "./db";
import {
  GOOGLE_ANALYTICS_KEY,
  googleSettingsInputSchema,
  SEARCH_CONSOLE_KEY,
  type GoogleSettingsInput,
} from "./google";
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

/**
 * Saves both Google connections in one statement (null clears one): the GA4 measurement id and
 * the Search Console token, never the text they were pasted in. Throws like saveShopCapMode.
 */
export async function saveGoogleSettings(input: unknown): Promise<GoogleSettingsInput> {
  await requireAdmin();
  const value = googleSettingsInputSchema.parse(input);
  await upsertSettings(serviceClient(), [
    { key: GOOGLE_ANALYTICS_KEY, value: { measurementId: value.measurementId } },
    { key: SEARCH_CONSOLE_KEY, value: { verification: value.siteVerification } },
  ]);
  updateTag(SETTINGS_TAG);
  return value;
}

/** Saves the community link (URL, button label, shown or not). Throws like saveShopCapMode. */
export async function saveCommunityLink(input: unknown): Promise<CommunityValue> {
  await requireAdmin();
  const value = communityValueSchema.parse(input);
  await upsertSetting(serviceClient(), COMMUNITY_KEY, value);
  updateTag(SETTINGS_TAG);
  return value;
}
