import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_SHOP_CAP_MODE } from "@/lib/ranking/config";
import { firstParam } from "@/lib/search-url";
import { shopCapSettingForAdmin } from "@/lib/settings/queries";
import { saveSettingsAction } from "./actions";
import { SettingsForm } from "./settings-form";
import { SettingsIntro } from "./settings-intro";
import { StatusMessage } from "../status-message";

export const metadata: Metadata = {
  title: "הגדרות", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  saved: "ההגדרה נשמרה. היא חלה על החיפושים שיתחילו מעכשיו.",
};

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  // Own keys only: "?status=__proto__" must not pick up Object.prototype.
  const statusKey = firstParam((await searchParams).status);
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;
  const setting = await shopCapSettingForAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-8 sm:px-6 sm:pt-12">
      <SettingsIntro />
      {status && <StatusMessage>{status}</StatusMessage>}
      {setting === null ? (
        <p className="flex items-start gap-3 rounded-2xl bg-gold-soft p-4 text-ink">
          <CloudOff aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>
            לא הצלחנו לקרוא את ההגדרה השמורה, ולכן החיפוש משתמש עכשיו בברירת המחדל (ללא הגבלה). אפשר
            לנסות לשמור שוב.
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted">
          {setting.updatedAt
            ? `נשמרה לאחרונה ב־${formatDateTime(setting.updatedAt)}.`
            : "עוד לא נשמרה הגדרה, ולכן חלה ברירת המחדל."}
        </p>
      )}
      {/* key: a save redirects here with the new stored mode, which starts a fresh form. */}
      <SettingsForm
        key={setting?.mode ?? DEFAULT_SHOP_CAP_MODE}
        action={saveSettingsAction}
        initial={{ mode: setting?.mode ?? DEFAULT_SHOP_CAP_MODE, error: null }}
      />
    </div>
  );
}
