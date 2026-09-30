"use client";

import { CircleAlert, KeyRound } from "lucide-react";
import { useActionState, useEffect, useId, useRef } from "react";
import { btnBusy, btnLg, btnPrimary, card } from "@/components/styles";
import { PASSWORD_MIN_LENGTH } from "@/lib/admin/rules";
import { changePasswordAction, type PasswordFormState } from "./actions";

const IDLE: PasswordFormState = { error: null };

const FIELD =
  "mt-2 h-12 w-full max-w-md rounded-full border border-line bg-surface px-5 text-base text-ink focus-visible:border-accent";

/** "שינוי סיסמה": the new password twice. A refusal clears both fields and focuses its message. */
export function ChangePasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, IDLE);
  const passwordId = useId();
  const confirmId = useId();
  const hintId = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) return;
    formRef.current?.reset();
    errorRef.current?.focus();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      className={`${card} space-y-5 p-5 sm:p-6`}
    >
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <KeyRound aria-hidden className="size-5 text-accent-ink" />
        שינוי סיסמה
      </h2>

      {state.error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-2xl bg-gold-soft p-4 font-semibold text-ink focus:outline-none"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>{state.error}</p>
        </div>
      )}

      {/* The account's email, so a password manager saves the new password under it. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div>
        <label htmlFor={passwordId} className="block text-sm font-semibold text-ink">
          סיסמה חדשה
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          dir="ltr"
          aria-describedby={hintId}
          className={FIELD}
        />
        <p id={hintId} className="mt-2 text-sm text-muted">
          לפחות {PASSWORD_MIN_LENGTH} תווים. כדאי לתת למנהל הסיסמאות של הדפדפן ליצור סיסמה ולשמור
          אותה.
        </p>
      </div>

      <div>
        <label htmlFor={confirmId} className="block text-sm font-semibold text-ink">
          הסיסמה החדשה שוב
        </label>
        <input
          id={confirmId}
          name="confirm"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          dir="ltr"
          className={FIELD}
        />
      </div>

      {/* aria-disabled, not disabled: the button keeps keyboard focus while saving. */}
      <button type="submit" aria-disabled={pending} className={`${btnPrimary} ${btnLg} ${btnBusy}`}>
        {pending ? "שומרים…" : "שמירת הסיסמה"}
      </button>
    </form>
  );
}
