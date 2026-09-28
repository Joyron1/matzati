"use client";

import { useActionState, useEffect, useRef } from "react";
import { btnBusy, btnLg, btnPrimary, card } from "@/components/styles";
import {
  COMMUNITY_ENABLED_FIELD,
  COMMUNITY_LABEL_FIELD,
  COMMUNITY_LABEL_MAX,
  COMMUNITY_URL_FIELD,
  COMMUNITY_URL_MAX,
  DEFAULT_COMMUNITY_LABEL,
  type CommunityFormState,
} from "@/lib/settings/community-link";
import { ErrorText, FormAlert, inputClass, StatusPill } from "./form-parts";

export type CommunityAction = (
  prev: CommunityFormState,
  formData: FormData,
) => Promise<CommunityFormState>;

/**
 * "קישור לקהילה": the footer's "join our community" button. The link must be https; the label
 * defaults to DEFAULT_COMMUNITY_LABEL; the button shows only while "הצגה באתר" is on (off until the
 * owner turns it on). `live` says whether the stored setting shows the button now. `action` is
 * saveCommunityAction (the dev preview passes one that saves nothing).
 */
export function CommunitySettingsForm({
  action,
  initial,
  live,
  savedNote,
}: {
  action: CommunityAction;
  initial: CommunityFormState;
  live: boolean;
  savedNote: string | null;
}) {
  const [state, formAction, pending] = useActionState<CommunityFormState, FormData>(
    action,
    initial,
  );
  const alertRef = useRef<HTMLDivElement>(null);
  const { values, errors } = state;
  const fieldErrors = [errors.url, errors.label].filter(Boolean).length;

  useEffect(() => {
    if (state !== initial && (state.errors.form || state.errors.url || state.errors.label)) {
      alertRef.current?.focus();
    }
  }, [state, initial]);

  const describe = (field: "url" | "label") =>
    [`community-${field}-hint`, errors[field] ? `community-${field}-error` : null]
      .filter(Boolean)
      .join(" ");

  return (
    // Inputs are uncontrolled with defaultValue from the last submit: React resets the form after
    // the action, and a rejected form comes back with what the admin typed.
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      noValidate
      className="space-y-5"
      aria-labelledby="community-heading"
    >
      <div className={`${card} space-y-6 p-5 sm:p-6`}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="community-heading" className="text-lg font-bold">
              קישור לקהילה
            </h2>
            <StatusPill on={live}>{live ? "מוצג באתר" : "לא מוצג באתר"}</StatusPill>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            כפתור בתחתית כל עמוד שמוביל לקהילה שלכם, למשל לקבוצת וואטסאפ או לערוץ טלגרם. הוא מופיע
            באתר רק כשהמתג ״הצגה באתר״ פועל ויש קישור תקין.
          </p>
          {savedNote && <p className="text-sm text-muted">{savedNote}</p>}
        </div>

        {(errors.form || fieldErrors > 0) && (
          <FormAlert ref={alertRef}>
            {errors.form && <p>{errors.form}</p>}
            {fieldErrors > 0 && (
              <p>
                {fieldErrors === 1
                  ? "לא שמרנו: יש שדה אחד לתקן. הוא מסומן למטה."
                  : "לא שמרנו: יש 2 שדות לתקן. הם מסומנים למטה."}
              </p>
            )}
          </FormAlert>
        )}

        <div className="space-y-2">
          <label htmlFor="community-url" className="block font-semibold">
            הקישור
          </label>
          <p id="community-url-hint" className="text-sm leading-relaxed text-muted">
            הקישור המלא, שמתחיל ב־<bdi dir="ltr">https://</bdi>. אפשר להשאיר ריק כל עוד הכפתור לא
            מוצג.
          </p>
          <input
            id="community-url"
            name={COMMUNITY_URL_FIELD}
            type="url"
            inputMode="url"
            dir="ltr"
            defaultValue={values.url}
            maxLength={COMMUNITY_URL_MAX}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder="https://chat.whatsapp.com/…"
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={describe("url")}
            className={inputClass}
          />
          {errors.url && <ErrorText id="community-url-error">{errors.url}</ErrorText>}
        </div>

        <div className="space-y-2">
          <label htmlFor="community-label" className="block font-semibold">
            הטקסט על הכפתור
          </label>
          <p id="community-label-hint" className="text-sm leading-relaxed text-muted">
            {`עד ${COMMUNITY_LABEL_MAX} תווים. שדה ריק: ״${DEFAULT_COMMUNITY_LABEL}״.`}
          </p>
          <input
            id="community-label"
            name={COMMUNITY_LABEL_FIELD}
            type="text"
            defaultValue={values.label}
            maxLength={COMMUNITY_LABEL_MAX}
            autoComplete="off"
            placeholder={DEFAULT_COMMUNITY_LABEL}
            aria-invalid={errors.label ? true : undefined}
            aria-describedby={describe("label")}
            className={inputClass}
          />
          {errors.label && <ErrorText id="community-label-error">{errors.label}</ErrorText>}
        </div>

        {/* The whole row is the switch's label: a 44px target at least. */}
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4 hover:border-accent">
          <span className="space-y-1">
            <span id="community-enabled-label" className="block font-semibold">
              הצגה באתר
            </span>
            <span id="community-enabled-hint" className="block text-sm leading-relaxed text-muted">
              כשהמתג כבוי הכפתור לא מופיע באתר, גם אם יש קישור.
            </span>
          </span>
          <span className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              role="switch"
              name={COMMUNITY_ENABLED_FIELD}
              defaultChecked={values.enabled}
              aria-labelledby="community-enabled-label"
              aria-describedby="community-enabled-hint"
              className="peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none opacity-0"
            />
            <span
              aria-hidden
              className="pointer-events-none h-7 w-12 rounded-full border-2 border-muted bg-surface peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-muted peer-checked:start-[1.875rem] peer-checked:bg-on-accent"
            />
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          aria-disabled={pending}
          className={`${btnPrimary} ${btnLg} ${btnBusy}`}
        >
          {pending ? "שומרים…" : "שמירת קישור הקהילה"}
        </button>
        <p aria-live="polite" className="sr-only">
          {pending ? "שומרים את קישור הקהילה" : ""}
        </p>
      </div>
    </form>
  );
}
