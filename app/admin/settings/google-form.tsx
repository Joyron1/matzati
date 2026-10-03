"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { btnBusy, btnLg, btnPrimary, card } from "@/components/styles";
import {
  extractMeasurementId,
  extractVerificationToken,
  GA_FIELD,
  GOOGLE_FIELD_MAX,
  GSC_FIELD,
  type Extraction,
  type GoogleFormState,
} from "@/lib/settings/google";
import { ErrorText, FormAlert, inputClass, smallButton, StatusPill } from "./form-parts";

export type GoogleAction = (prev: GoogleFormState, formData: FormData) => Promise<GoogleFormState>;

/** What is stored now (read fresh by the page), to say what is live and what a save changes. */
export interface StoredGoogle {
  measurementId: string | null;
  siteVerification: string | null;
}

/**
 * "חיבור לגוגל": two fields where the owner pastes what Google gives (the gtag.js snippet or the
 * measurement id; the Search Console <meta> tag or its content). Under each field the same
 * extraction the save runs shows, while typing, what will be stored; nothing pasted is stored or
 * rendered as HTML. An empty field removes that connection. `action` is saveGoogleAction (the dev
 * preview passes one that saves nothing).
 */
export function GoogleSettingsForm({
  action,
  initial,
  stored,
  savedNote,
}: {
  action: GoogleAction;
  initial: GoogleFormState;
  /** Null when the stored values could not be read. */
  stored: StoredGoogle | null;
  /** "נשמר לאחרונה ב־…", or a note that nothing was saved yet. */
  savedNote: string | null;
}) {
  const [state, formAction, pending] = useActionState<GoogleFormState, FormData>(action, initial);
  const alertRef = useRef<HTMLDivElement>(null);
  const fieldErrors = [state.errors.ga, state.errors.gsc].filter(Boolean).length;
  const hasErrors = Boolean(state.errors.form) || fieldErrors > 0;

  // After a rejected save, move focus to the message so screen readers hear what to fix.
  useEffect(() => {
    if (state !== initial && (state.errors.form || state.errors.ga || state.errors.gsc)) {
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
      aria-labelledby="google-heading"
    >
      <div className={`${card} space-y-6 p-5 sm:p-6`}>
        <div className="space-y-2">
          <h2 id="google-heading" className="text-lg font-bold">
            חיבור לגוגל
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            הדביקו כאן את מה שגוגל נותנת: את כל קטע הקוד, או רק את המזהה. אנחנו שומרים רק את המזהה
            שזיהינו, לא את הקוד עצמו. שדה ריק מסיר את החיבור.
          </p>
          {savedNote && <p className="text-sm text-muted">{savedNote}</p>}
        </div>

        {hasErrors && (
          <FormAlert ref={alertRef}>
            {state.errors.form && <p>{state.errors.form}</p>}
            {fieldErrors > 0 && (
              <p>
                {fieldErrors === 1
                  ? "לא שמרנו: יש שדה אחד לתקן. הוא מסומן למטה."
                  : "לא שמרנו: יש 2 שדות לתקן. הם מסומנים למטה."}
              </p>
            )}
          </FormAlert>
        )}

        <ConnectionField
          name={GA_FIELD}
          label="Google Analytics 4"
          status={stored?.measurementId ? "מחובר" : "לא מחובר"}
          on={Boolean(stored?.measurementId)}
          hint={
            <>
              ב־Google Analytics:{" "}
              <Ltr>
                Admin → Data streams → (the site) → View tag instructions → Install manually
              </Ltr>
              . העתיקו את כל הקוד, או רק את מזהה המדידה, למשל <Ltr>G-AB12CD34EF</Ltr>.
            </>
          }
          placeholder={
            '<script async src="https://www.googletagmanager.com/gtag/js?id=G-…"></script>'
          }
          defaultValue={state.values.ga}
          storedValue={stored?.measurementId ?? null}
          error={state.errors.ga}
          extract={extractMeasurementId}
          foundLabel="מזהה המדידה"
        >
          <div className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm leading-relaxed">
            <p>
              Google Analytics נטען אצל כל המבקרים במצב ההסכמה המתקדם של Google (Consent Mode): בלי
              אישור הוא שולח מדידה בלי עוגיות ובלי מזהה, ואת עוגיות <Ltr>_ga</Ltr> הוא שומר רק אצל
              מי שאישר עוגיות סטטיסטיקה. כשיש מזהה שמור, הודעת העוגיות, מדיניות העוגיות ומדיניות
              הפרטיות מתארות אותו, וכל המבקרים יתבקשו לבחור שוב בהודעת העוגיות.
            </p>
            <p>
              חשוב: האתר שולח צפייה בדף בכל מעבר עמוד בעצמו, בלי טקסט החיפוש. לכן כבו ב־Google
              Analytics את{" "}
              <Ltr>
                Data streams → (the site) → Enhanced measurement → Page views → Show advanced
                settings → Page changes based on browser history events
              </Ltr>
              . אחרת כל צפייה תיספר פעמיים, ו־Google תקבל גם את הכתובת המלאה, כולל מה שחיפשו.
            </p>
            <p>
              חשוב לא פחות: כבו גם את{" "}
              <Ltr>Data streams → (the site) → Enhanced measurement → Site search</Ltr>. המדידה הזו
              קוראת את הכתובת בדפדפן בעצמה ושולחת ל־Google את טקסט החיפוש (<Ltr>search_term</Ltr>),
              בניגוד למה שמדיניות הפרטיות מבטיחה (נבדק בדפדפן אמיתי ב־3.10.2026).
            </p>
          </div>
        </ConnectionField>

        <ConnectionField
          name={GSC_FIELD}
          label="Google Search Console"
          status={stored?.siteVerification ? "תג האימות באתר" : "אין תג אימות"}
          on={Boolean(stored?.siteVerification)}
          hint={
            <>
              ב־Search Console הוסיפו נכס מסוג <Ltr>URL prefix</Ltr> עם כתובת האתר, ובשיטות האימות
              בחרו <Ltr>HTML tag</Ltr>. הדביקו כאן את התג כולו, או רק את הערך שב־<Ltr>content</Ltr>,
              שמרו, ואז לחצו <Ltr>Verify</Ltr> ב־Search Console. השאירו את התג שמור גם אחרי האימות.
            </>
          }
          placeholder={'<meta name="google-site-verification" content="…" />'}
          defaultValue={state.values.gsc}
          storedValue={stored?.siteVerification ?? null}
          error={state.errors.gsc}
          extract={extractVerificationToken}
          foundLabel="קוד האימות"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* aria-disabled, not disabled: the button keeps keyboard focus while saving. */}
        <button
          type="submit"
          aria-disabled={pending}
          className={`${btnPrimary} ${btnLg} ${btnBusy}`}
        >
          {pending ? "שומרים…" : "שמירת החיבור לגוגל"}
        </button>
        <p aria-live="polite" className="sr-only">
          {pending ? "שומרים את החיבור לגוגל" : ""}
        </p>
      </div>
    </form>
  );
}

/** English (Google's menu names, ids) kept left to right inside the Hebrew text. */
function Ltr({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="font-medium">
      {children}
    </bdi>
  );
}

interface Preview {
  tone: "ok" | "warn" | "muted";
  text: string;
  /** The extracted id or token, shown left to right. */
  value?: string;
}

/** What a field will store, in words, for the line under it. */
function preview(result: Extraction, storedValue: string | null, foundLabel: string): Preview {
  if (result.kind === "empty") {
    return storedValue
      ? { tone: "warn", text: "השדה ריק: בשמירה החיבור יוסר." }
      : { tone: "muted", text: "השדה ריק. אין חיבור." };
  }
  if (result.kind === "error") return { tone: "warn", text: result.message };
  const status = result.value === storedValue ? "שמור" : "יישמר בלחיצה על שמירה";
  return { tone: "ok", text: `זיהינו ${foundLabel} (${status}):`, value: result.value };
}

function ConnectionField({
  name,
  label,
  status,
  on,
  hint,
  placeholder,
  defaultValue,
  storedValue,
  error,
  extract,
  foundLabel,
  children,
}: {
  name: string;
  label: string;
  status: string;
  on: boolean;
  hint: ReactNode;
  placeholder: string;
  defaultValue: string;
  storedValue: string | null;
  error?: string;
  extract(text: string): Extraction;
  foundLabel: string;
  children?: ReactNode;
}) {
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(defaultValue);
  const shown = preview(extract(text), storedValue, foundLabel);
  // The save's message is about the text as submitted (defaultValue is the submitted text); once
  // the field changes, the live line under it takes over. The same message is not shown twice.
  const shownError = error && text === defaultValue ? error : undefined;
  const previewText = shownError && shown.text === shownError ? "" : shown.text;
  const describedBy = [`${id}-hint`, `${id}-preview`, shownError ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="font-semibold">
          <bdi dir="ltr">{label}</bdi>
        </label>
        <StatusPill on={on}>{status}</StatusPill>
      </div>
      <p id={`${id}-hint`} className="text-sm leading-relaxed text-muted">
        {hint}
      </p>
      <textarea
        ref={textareaRef}
        id={id}
        name={name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        dir="ltr"
        maxLength={GOOGLE_FIELD_MAX}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={placeholder}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={describedBy}
        className={`${inputClass} min-h-24 font-mono text-sm`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id={`${id}-preview`}
          aria-live="polite"
          className={`text-sm ${
            shown.tone === "ok"
              ? "font-semibold text-ink"
              : shown.tone === "warn"
                ? "text-ink"
                : "text-muted"
          }`}
        >
          {previewText}
          {shown.value && (
            <>
              {" "}
              <bdi dir="ltr" className="font-mono break-all">
                {shown.value}
              </bdi>
            </>
          )}
        </p>
        {text !== "" && (
          <button
            type="button"
            onClick={() => {
              setText("");
              textareaRef.current?.focus();
            }}
            className={smallButton}
          >
            ניקוי השדה
          </button>
        )}
      </div>
      {shownError && <ErrorText id={`${id}-error`}>{shownError}</ErrorText>}
      {children}
    </div>
  );
}
