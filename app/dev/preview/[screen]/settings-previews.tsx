"use client";

// Development preview only: the /admin/settings sections "חיבור לגוגל", "חיבור ל־Meta" and
// "קישור לקהילה" with
// actions that save nothing. A valid save answers, after a short wait (the busy button), with the
// "could not save" message; an invalid one with the same field messages as the real form.
import { CommunitySettingsForm } from "@/app/admin/settings/community-form";
import { GoogleSettingsForm, type StoredGoogle } from "@/app/admin/settings/google-form";
import { MetaSettingsForm } from "@/app/admin/settings/meta-form";
import {
  COMMUNITY_ERRORS,
  communityFormValues,
  parseCommunityForm,
  type CommunityFormState,
  type CommunityValue,
} from "@/lib/settings/community-link";
import {
  EXTRACT_ERRORS,
  GOOGLE_FORM_ERRORS,
  parseGoogleForm,
  type GoogleFormState,
} from "@/lib/settings/google";
import {
  META_EXTRACT_ERRORS,
  META_FORM_ERRORS,
  parseMetaForm,
  type MetaFormState,
} from "@/lib/settings/meta";

const wait = () => new Promise((resolve) => setTimeout(resolve, 800));

export function PreviewGoogleForm({
  stored,
  failed,
}: {
  stored: StoredGoogle | null;
  failed: boolean;
}) {
  const values = { ga: stored?.measurementId ?? "", gsc: stored?.siteVerification ?? "" };
  const initial: GoogleFormState = failed
    ? {
        values: { ga: "UA-12345678-1", gsc: '<meta name="description" content="…">' },
        errors: { ga: EXTRACT_ERRORS.gaUniversal, gsc: EXTRACT_ERRORS.gscOtherTag },
      }
    : { values, errors: {} };
  return (
    <GoogleSettingsForm
      action={async (_prev, formData) => {
        await wait();
        const parsed = parseGoogleForm(formData);
        if (!parsed.ok) return parsed.state;
        return {
          values: {
            ga: parsed.value.measurementId ?? "",
            gsc: parsed.value.siteVerification ?? "",
          },
          errors: { form: GOOGLE_FORM_ERRORS.saveFailed },
        };
      }}
      initial={initial}
      stored={stored}
      savedNote={
        stored?.measurementId ? "נשמר לאחרונה ב־28.9.2026, 23:00 (לדוגמה)." : "עוד לא נשמר."
      }
    />
  );
}

export function PreviewMetaForm({
  storedPixelId,
  failed,
}: {
  storedPixelId: string | null;
  failed: boolean;
}) {
  const initial: MetaFormState = failed
    ? { values: { pixel: "12345" }, errors: { pixel: META_EXTRACT_ERRORS.notFound } }
    : { values: { pixel: storedPixelId ?? "" }, errors: {} };
  return (
    <MetaSettingsForm
      action={async (_prev, formData) => {
        await wait();
        const parsed = parseMetaForm(formData);
        if (!parsed.ok) return parsed.state;
        return {
          values: { pixel: parsed.value.pixelId ?? "" },
          errors: { form: META_FORM_ERRORS.saveFailed },
        };
      }}
      initial={initial}
      storedPixelId={storedPixelId}
      readFailed={false}
      savedNote={storedPixelId ? "נשמר לאחרונה ב־4.10.2026, 12:00 (לדוגמה)." : "עוד לא נשמר."}
    />
  );
}

export function PreviewCommunityForm({
  stored,
  failed,
}: {
  stored: CommunityValue;
  failed: boolean;
}) {
  const initial: CommunityFormState = failed
    ? {
        values: { url: "http://chat.whatsapp.com/preview", label: stored.label, enabled: true },
        errors: { url: COMMUNITY_ERRORS.urlNotHttps },
      }
    : { values: communityFormValues(stored), errors: {} };
  return (
    <CommunitySettingsForm
      action={async (_prev, formData) => {
        await wait();
        const parsed = parseCommunityForm(formData);
        if (!parsed.ok) return parsed.state;
        return {
          values: communityFormValues(parsed.value),
          errors: { form: COMMUNITY_ERRORS.saveFailed },
        };
      }}
      initial={initial}
      live={stored.enabled && stored.url !== null}
      savedNote={stored.url ? "נשמר לאחרונה ב־28.9.2026, 23:00 (לדוגמה)." : "עוד לא נשמר."}
    />
  );
}
