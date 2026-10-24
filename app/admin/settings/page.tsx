import type { Metadata } from "next";
import { BarChart3, CloudOff, Megaphone, SlidersHorizontal, Users } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_SHOP_CAP_MODE } from "@/lib/ranking/config";
import { firstParam } from "@/lib/search-url";
import {
  communityFormValues,
  DEFAULT_COMMUNITY_VALUE,
  type CommunityValue,
} from "@/lib/settings/community-link";
import { publicSettingsForAdmin, shopCapSettingForAdmin } from "@/lib/settings/queries";
import {
  saveCommunityAction,
  saveGoogleAction,
  saveMetaAction,
  saveSettingsAction,
} from "./actions";
import { CommunitySettingsForm } from "./community-form";
import { GoogleSettingsForm } from "./google-form";
import { MetaSettingsForm } from "./meta-form";
import { SettingsForm } from "./settings-form";
import { AdminHeader, AdminTabs } from "../admin-tabs";
import { StatusMessage } from "../status-message";

/** The page's tabs (owner request 2026-10-24: one section at a time instead of one long page). */
const TABS = ["search", "google", "meta", "community"] as const;
type Tab = (typeof TABS)[number];

export const metadata: Metadata = {
  title: "הגדרות", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  saved: "ההגדרה נשמרה. היא חלה על החיפושים שיתחילו מעכשיו.",
  "google-saved": "החיבור לגוגל נשמר. הוא חל על כל עמוד מהטעינה הבאה שלו.",
  "meta-saved": "החיבור ל־Meta נשמר. הוא חל על כל עמוד מהטעינה הבאה שלו.",
  "community-saved": "קישור הקהילה נשמר. הוא חל על כל עמוד מהטעינה הבאה שלו.",
};

/** "נשמר לאחרונה ב־…" for a section, or that nothing was saved yet. */
function savedNote(updatedAt: string | null): string {
  return updatedAt ? `נשמר לאחרונה ב־${formatDateTime(updatedAt)}.` : "עוד לא נשמר.";
}

/** Shown in place of a section's saved-at line when the stored values could not be read. */
function ReadFailed({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-3 rounded-2xl bg-gold-soft p-4 text-ink">
      <CloudOff aria-hidden className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  // Own keys only: "?status=__proto__" must not pick up Object.prototype.
  const params = await searchParams;
  const statusKey = firstParam(params.status);
  const tabParam = firstParam(params.tab);
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "search";
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;
  const [setting, connections] = await Promise.all([
    shopCapSettingForAdmin(),
    publicSettingsForAdmin(),
  ]);
  const google = connections?.google ?? null;
  const community: CommunityValue = connections?.community ?? DEFAULT_COMMUNITY_VALUE;

  const googleOn = Boolean(google?.measurementId || google?.siteVerification);
  const metaOn = Boolean(connections?.meta.pixelId);
  const communityOn = community.enabled && community.url !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-8 sm:px-6 sm:pt-12">
      <AdminHeader title="הגדרות" subtitle="הגדרות האתר. הן חלות על כל המבקרים." />
      <AdminTabs
        label="חלקי ההגדרות"
        base="/admin/settings"
        current={tab}
        tabs={[
          { key: "search", label: "חיפוש", icon: SlidersHorizontal },
          { key: "google", label: "גוגל", icon: BarChart3, dot: googleOn ? "on" : "off" },
          { key: "meta", label: "Meta Pixel", icon: Megaphone, dot: metaOn ? "on" : "off" },
          { key: "community", label: "קהילה", icon: Users, dot: communityOn ? "on" : "off" },
        ]}
      />
      {status && <StatusMessage>{status}</StatusMessage>}
      {tab !== "search" && connections === null && (
        <ReadFailed>
          לא הצלחנו לקרוא את החיבורים לגוגל ול־Meta ואת קישור הקהילה, ולכן האתר פועל עכשיו בלעדיהם.
          אפשר לנסות לשמור שוב.
        </ReadFailed>
      )}

      {tab === "search" && (
        <div className="space-y-3">
          {setting === null ? (
            <ReadFailed>
              לא הצלחנו לקרוא את ההגדרה השמורה, ולכן החיפוש משתמש עכשיו בברירת המחדל (ללא הגבלה).
              אפשר לנסות לשמור שוב.
            </ReadFailed>
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
      )}

      {tab === "google" && (
        // key: a save redirects here with the new stored values, which starts a fresh form.
        <GoogleSettingsForm
          key={`${google?.measurementId}|${google?.siteVerification}|${google?.updatedAt}`}
          action={saveGoogleAction}
          initial={{
            values: { ga: google?.measurementId ?? "", gsc: google?.siteVerification ?? "" },
            errors: {},
          }}
          stored={google}
          savedNote={google ? savedNote(google.updatedAt) : null}
        />
      )}

      {tab === "meta" && (
        <MetaSettingsForm
          key={`${connections?.meta.pixelId}|${connections?.meta.updatedAt}`}
          action={saveMetaAction}
          initial={{ values: { pixel: connections?.meta.pixelId ?? "" }, errors: {} }}
          storedPixelId={connections?.meta.pixelId ?? null}
          readFailed={connections === null}
          savedNote={connections ? savedNote(connections.meta.updatedAt) : null}
        />
      )}

      {tab === "community" && (
        <CommunitySettingsForm
          key={`${community.url}|${community.label}|${community.enabled}|${connections?.community.updatedAt}`}
          action={saveCommunityAction}
          initial={{ values: communityFormValues(community), errors: {} }}
          live={communityOn}
          savedNote={connections ? savedNote(connections.community.updatedAt) : null}
        />
      )}
    </div>
  );
}
