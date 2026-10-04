"use client";

import { useActionState, useEffect, useRef } from "react";
import { btnBusy, btnLg, btnPrimary, card } from "@/components/styles";
import { extractPixelId, META_PIXEL_FIELD, type MetaFormState } from "@/lib/settings/meta";
import { FormAlert } from "./form-parts";
import { ConnectionField, Ltr } from "./google-form";

export type MetaAction = (prev: MetaFormState, formData: FormData) => Promise<MetaFormState>;

/**
 * "חיבור ל־Meta (פייסבוק ואינסטגרם)": one field where the owner pastes the Meta Pixel's base code
 * or its id. Under the field the same extraction the save runs shows, while typing, the id that
 * will be stored; nothing pasted is stored or rendered as HTML. An empty field removes the
 * connection. `action` is saveMetaAction (the dev preview passes one that saves nothing).
 */
export function MetaSettingsForm({
  action,
  initial,
  storedPixelId,
  readFailed,
  savedNote,
}: {
  action: MetaAction;
  initial: MetaFormState;
  /** The stored id (read fresh by the page), or null. */
  storedPixelId: string | null;
  /** The stored value could not be read. */
  readFailed: boolean;
  /** "נשמר לאחרונה ב־…", or a note that nothing was saved yet. */
  savedNote: string | null;
}) {
  const [state, formAction, pending] = useActionState<MetaFormState, FormData>(action, initial);
  const alertRef = useRef<HTMLDivElement>(null);
  const hasErrors = Boolean(state.errors.form || state.errors.pixel);

  // After a rejected save, move focus to the message so screen readers hear what to fix.
  useEffect(() => {
    if (state !== initial && (state.errors.form || state.errors.pixel)) {
      alertRef.current?.focus();
    }
  }, [state, initial]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      noValidate
      className="space-y-5"
      aria-labelledby="meta-heading"
    >
      <div className={`${card} space-y-6 p-5 sm:p-6`}>
        <div className="space-y-2">
          <h2 id="meta-heading" className="text-lg font-bold">
            חיבור ל־Meta (פייסבוק ואינסטגרם)
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            הדביקו כאן את קוד הבסיס של הפיקסל (Meta Pixel) כולו, או רק את מזהה הפיקסל. אנחנו שומרים
            רק את המזהה שזיהינו, לא את הקוד עצמו. שדה ריק מסיר את החיבור.
          </p>
          {savedNote && <p className="text-sm text-muted">{savedNote}</p>}
        </div>

        {hasErrors && (
          <FormAlert ref={alertRef}>
            {state.errors.form && <p>{state.errors.form}</p>}
            {state.errors.pixel && <p>לא שמרנו: יש שדה אחד לתקן. הוא מסומן למטה.</p>}
          </FormAlert>
        )}

        <ConnectionField
          name={META_PIXEL_FIELD}
          label="Meta Pixel"
          status={readFailed ? "לא ידוע" : storedPixelId ? "מחובר" : "לא מחובר"}
          on={Boolean(storedPixelId)}
          hint={
            <>
              ב־Meta: <Ltr>Events Manager → Data sources → (the pixel) → Settings → Pixel ID</Ltr>.
              העתיקו את המספר (10 עד 20 ספרות), או את כל קוד הבסיס שמופיע בהתקנה הידנית של הפיקסל (
              <Ltr>Install code manually</Ltr>).
            </>
          }
          placeholder={"fbq('init', '1234567890123456');"}
          defaultValue={state.values.pixel}
          storedValue={storedPixelId}
          error={state.errors.pixel}
          extract={extractPixelId}
          foundLabel="מזהה הפיקסל"
        >
          <div className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm leading-relaxed">
            <p>
              הפיקסל נטען רק אצל מי שאישר עוגיות שיווק, ובלי אישור לא נשלח ל־Meta דבר. הוא שולח
              צפייה בעמוד רק בעמודים שבכתובת שלהם אין טקסט חיפוש, ולחיצה לקנייה באלי אקספרס עם מזהה
              המוצר בלבד (דרך עמוד מעבר קצר). כשיש מזהה שמור, הודעת העוגיות, מדיניות העוגיות
              ומדיניות הפרטיות מתארות אותו, וכל המבקרים יתבקשו לבחור שוב בהודעת העוגיות.
            </p>
            <p>
              חשוב: ב־Events Manager, בהגדרות הפיקסל (<Ltr>Settings</Ltr>), כבו את{" "}
              <Ltr>Automatic advanced matching</Ltr> ואת{" "}
              <Ltr>Track events automatically without code</Ltr>. האתר לא שולח ל־Meta שם, אימייל או
              טלפון ולא אירועים אוטומטיים, ומדיניות הפרטיות מבטיחה זאת. אם ההגדרות האלה פועלות, Meta
              עלולה לאסוף בעצמה מידע מהעמוד, בניגוד להבטחה.
            </p>
          </div>
        </ConnectionField>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* aria-disabled, not disabled: the button keeps keyboard focus while saving. */}
        <button
          type="submit"
          aria-disabled={pending}
          className={`${btnPrimary} ${btnLg} ${btnBusy}`}
        >
          {pending ? "שומרים…" : "שמירת החיבור ל־Meta"}
        </button>
        <p aria-live="polite" className="sr-only">
          {pending ? "שומרים את החיבור ל־Meta" : ""}
        </p>
      </div>
    </form>
  );
}
