"use client";

import { useRouter } from "next/navigation";
import { SettingsForm } from "@/app/admin/settings/settings-form";
import { btnMd, btnSecondary } from "@/components/styles";
import type { ShopCapMode } from "@/lib/ranking/config";
import { parseSettingsForm, SETTINGS_ERRORS } from "@/lib/settings/schema";

/**
 * Development preview only: the /admin/settings form with an action that saves nothing. A save
 * after a short wait (the busy button) answers with the "could not save" message, the form's only
 * other state; `failed` shows that message from the start.
 */
export function PreviewSettingsForm({ mode, failed }: { mode: ShopCapMode; failed: boolean }) {
  return (
    <SettingsForm
      action={async (prev, formData) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const value = parseSettingsForm(formData);
        return {
          mode: value?.mode ?? prev.mode,
          error: value ? SETTINGS_ERRORS.saveFailed : SETTINGS_ERRORS.invalid,
        };
      }}
      initial={{ mode, error: failed ? SETTINGS_ERRORS.saveFailed : null }}
    />
  );
}

/**
 * Development preview only: buttons that move /dev/preview/search-update to another view of the
 * same made-up search, the way a sort link moves /search (a client navigation, the results kept on
 * screen until the next view is complete). Nothing here reaches /search.
 */
export function PreviewViewSwitch({ views }: { views: { label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      {views.map((v) => (
        <button
          key={v.href}
          type="button"
          onClick={() => router.push(v.href, { scroll: false })}
          className={`${btnSecondary} ${btnMd}`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
