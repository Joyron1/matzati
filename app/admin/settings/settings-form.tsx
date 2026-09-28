"use client";

import { CircleAlert } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { btnBusy, btnLg, btnPrimary, card } from "@/components/styles";
import { RESULTS_KEPT, RESULTS_PER_PAGE } from "@/lib/config/site";
import { MAX2_SHOP_CAP as max2, type ShopCapMode } from "@/lib/ranking/config";
import { SHOP_CAP_FIELD, type SettingsFormState } from "@/lib/settings/schema";

/** The choices, in the order shown. Their numbers come from the ranking's own config. */
const OPTIONS: { mode: ShopCapMode; label: string; hint: string }[] = [
  {
    mode: "none",
    label: "ללא הגבלה",
    hint: "כל מוצר שעבר את הסינון יכול להופיע, גם כמה מוצרים מאותה חנות. מודעות כפולות של אותו מוצר עדיין מוסרות.",
  },
  {
    mode: "max2",
    label: `עד ${max2.firstPage} מאותה חנות מתוך ${RESULTS_PER_PAGE}`,
    hint: `בעמוד הראשון יופיעו עד ${max2.firstPage} מוצרים מאותה חנות, ובכל ${RESULTS_KEPT} המוצרים של החיפוש עד ${max2.kept}, אלא אם אין מספיק מוצרים מחנויות אחרות.`,
  },
];

export type SettingsAction = (
  prev: SettingsFormState,
  formData: FormData,
) => Promise<SettingsFormState>;

/**
 * The /admin/settings form: one radio group for the shop cap of the search results. `action` is
 * saveSettingsAction (the dev preview passes one that saves nothing); `initial` is the stored
 * mode. After a rejected save the chosen mode stays selected and the message gets focus.
 */
export function SettingsForm({
  action,
  initial,
}: {
  action: SettingsAction;
  initial: SettingsFormState;
}) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(action, initial);
  const errorRef = useRef<HTMLDivElement>(null);

  // After a rejected save, move focus to the message so screen readers hear it.
  useEffect(() => {
    if (state.error && state !== initial) errorRef.current?.focus();
  }, [state, initial]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      className="space-y-6"
    >
      {state.error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-2xl bg-gold-soft p-4 font-semibold text-ink"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>{state.error}</p>
        </div>
      )}

      <fieldset className={`${card} space-y-4 p-5 sm:p-6`} aria-describedby="shop-cap-note">
        <legend className="float-start mb-1 w-full text-lg font-bold">
          מוצרים מאותה חנות בתוצאות
        </legend>
        <p id="shop-cap-note" className="clear-both text-sm leading-relaxed text-muted">
          שינוי ההגדרה מאפס את התוצאות השמורות: החיפושים הראשונים אחרי השינוי הם חיפושים חדשים, וכל
          אחד מהם עולה כמו חיפוש חדש (בדיקה באלי אקספרס והסבר חדש). ההגדרה חלה על החיפושים שיתחילו
          אחרי השמירה.
        </p>
        <div className="space-y-3">
          {OPTIONS.map((o) => (
            <label
              key={o.mode}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name={SHOP_CAP_FIELD}
                value={o.mode}
                defaultChecked={state.mode === o.mode}
                required
                aria-describedby={`shop-cap-${o.mode}-hint`}
                className="mt-1 size-5 shrink-0 accent-accent focus-visible:outline-none"
              />
              <span className="space-y-1">
                <span className="block font-semibold">{o.label}</span>
                <span
                  id={`shop-cap-${o.mode}-hint`}
                  className="block text-sm leading-relaxed text-muted"
                >
                  {o.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        {/* aria-disabled, not disabled: the button keeps keyboard focus while saving. */}
        <button
          type="submit"
          aria-disabled={pending}
          className={`${btnPrimary} ${btnLg} ${btnBusy}`}
        >
          {pending ? "שומרים…" : "שמירה"}
        </button>
        <p aria-live="polite" className="sr-only">
          {pending ? "שומרים את ההגדרה" : ""}
        </p>
      </div>
    </form>
  );
}
