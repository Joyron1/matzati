// Owner settings (public.site_settings, 20260928230100_site_settings.sql): their keys, the shape
// of each stored value, and the admin form. Pure: the reads and the write are in ./queries.ts and
// ./admin.ts, the query builders in ./db.ts.
import { z } from "zod";
import { DEFAULT_SHOP_CAP_MODE, SHOP_CAP_MODES, type ShopCapMode } from "@/lib/ranking/config";

/** Cache tag of every settings read; the admin's save expires it (updateTag). */
export const SETTINGS_TAG = "settings";

/** site_settings.key of the shop cap of the search results. */
export const SHOP_CAP_KEY = "shop_cap";

/** site_settings.value of SHOP_CAP_KEY. */
export const shopCapValueSchema = z.object({ mode: z.enum(SHOP_CAP_MODES) });
export type ShopCapValue = z.infer<typeof shopCapValueSchema>;

/**
 * The mode a stored value names, or null when the value is not a shop cap setting (a hand-edited
 * row, a mode this code does not know): the caller then uses DEFAULT_SHOP_CAP_MODE.
 */
export function shopCapModeOf(value: unknown): ShopCapMode | null {
  const parsed = shopCapValueSchema.safeParse(value);
  return parsed.success ? parsed.data.mode : null;
}

/** What /admin/settings shows: the stored mode, or the default while none is stored. */
export interface ShopCapSetting {
  mode: ShopCapMode;
  /** False while no row is stored (the default applies). */
  stored: boolean;
  /** When the row was last saved (ISO), or null. */
  updatedAt: string | null;
}

export const DEFAULT_SHOP_CAP_SETTING: ShopCapSetting = {
  mode: DEFAULT_SHOP_CAP_MODE,
  stored: false,
  updatedAt: null,
};

/** The admin form's field. */
export const SHOP_CAP_FIELD = "shop_cap_mode";

/** The admin form's state for useActionState. */
export interface SettingsFormState {
  /** The mode the form shows (the last one chosen). */
  mode: ShopCapMode;
  error: string | null;
}

export const SETTINGS_ERRORS = {
  invalid: "בחרו אחת מהאפשרויות.",
  saveFailed: "לא הצלחנו לשמור את ההגדרה. נסו שוב בעוד רגע.",
} as const;

/** The submitted form as a setting value, or null when the choice is not one of the modes. */
export function parseSettingsForm(formData: FormData): ShopCapValue | null {
  const parsed = shopCapValueSchema.safeParse({ mode: formData.get(SHOP_CAP_FIELD) });
  return parsed.success ? parsed.data : null;
}
