"use server";
// The admin's save of the site settings. The action checks requireAdmin() itself (actions are
// reachable by a direct POST, so the guarded /admin layout is not enough), validates the choice
// with zod, and saveShopCapMode checks both again right before the service-role write and expires
// the "settings" cache tag (updateTag), so the next search ranks under the new mode.
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { saveShopCapMode } from "@/lib/settings/admin";
import { parseSettingsForm, SETTINGS_ERRORS, type SettingsFormState } from "@/lib/settings/schema";

function logError(where: string, err: unknown) {
  // Name and message only. Our errors name the operation, never a value.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-settings] ${where}: ${text.slice(0, 300)}`);
}

/** Saves the shop cap choice of the /admin/settings form (useActionState). */
export async function saveSettingsAction(
  prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();
  const value = parseSettingsForm(formData);
  if (!value) return { mode: prev.mode, error: SETTINGS_ERRORS.invalid };
  try {
    await saveShopCapMode(value);
  } catch (err) {
    // requireAdmin's redirect to the login is Next's control flow, not a failed save.
    unstable_rethrow(err);
    logError("save", err);
    return { mode: value.mode, error: SETTINGS_ERRORS.saveFailed };
  }
  revalidatePath("/admin/settings");
  redirect("/admin/settings?status=saved");
}
