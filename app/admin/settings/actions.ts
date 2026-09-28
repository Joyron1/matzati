"use server";
// The admin's saves of the site settings. Each action checks requireAdmin() itself (actions are
// reachable by a direct POST, so the guarded /admin layout is not enough), validates the form
// with zod, and the lib/settings/admin.ts write checks both again right before the service-role
// write and expires the "settings" cache tag (updateTag), so the next search and the next page
// render read the new value.
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { saveCommunityLink, saveGoogleSettings, saveShopCapMode } from "@/lib/settings/admin";
import {
  COMMUNITY_ERRORS,
  communityFormValues,
  parseCommunityForm,
  type CommunityFormState,
} from "@/lib/settings/community-link";
import { GOOGLE_FORM_ERRORS, parseGoogleForm, type GoogleFormState } from "@/lib/settings/google";
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

/**
 * Saves the "חיבור לגוגל" form: the GA4 measurement id and the Search Console token extracted
 * from what was pasted (an empty field removes that connection). The pasted text is never stored.
 */
export async function saveGoogleAction(
  _prev: GoogleFormState,
  formData: FormData,
): Promise<GoogleFormState> {
  await requireAdmin();
  const parsed = parseGoogleForm(formData);
  if (!parsed.ok) return parsed.state;
  try {
    await saveGoogleSettings(parsed.value);
  } catch (err) {
    unstable_rethrow(err);
    logError("save google", err);
    return {
      values: { ga: parsed.value.measurementId ?? "", gsc: parsed.value.siteVerification ?? "" },
      errors: { form: GOOGLE_FORM_ERRORS.saveFailed },
    };
  }
  revalidatePath("/admin/settings");
  redirect("/admin/settings?status=google-saved");
}

/** Saves the "קישור לקהילה" form: the link, the button label and whether it is shown. */
export async function saveCommunityAction(
  _prev: CommunityFormState,
  formData: FormData,
): Promise<CommunityFormState> {
  await requireAdmin();
  const parsed = parseCommunityForm(formData);
  if (!parsed.ok) return parsed.state;
  try {
    await saveCommunityLink(parsed.value);
  } catch (err) {
    unstable_rethrow(err);
    logError("save community", err);
    return {
      values: communityFormValues(parsed.value),
      errors: { form: COMMUNITY_ERRORS.saveFailed },
    };
  }
  revalidatePath("/admin/settings");
  redirect("/admin/settings?status=community-saved");
}
