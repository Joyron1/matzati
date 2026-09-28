"use client";

import { useActionState, useId } from "react";
import { CircleAlert, MailCheck, Send } from "lucide-react";
import { btnBusy, btnLg, btnPrimary } from "@/components/styles";
import type { LoginState } from "@/lib/admin/rules";
import { requestMagicLink } from "./actions";

const IDLE: LoginState = { status: "idle", message: "" };

/** `notice` is the Hebrew message for a failed magic link (from ?error=), shown until the next try. */
export function LoginForm({ notice }: { notice: string | null }) {
  const [state, formAction, pending] = useActionState(requestMagicLink, IDLE);
  const inputId = useId();
  const hintId = useId();

  const sent = state.status === "sent";
  const message = state.status === "idle" ? notice : state.message;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      className="mt-6 flex flex-col gap-4"
    >
      {message && (
        <p
          role={sent ? "status" : "alert"}
          className={`flex items-start gap-3 rounded-tile px-4 py-3 text-sm leading-relaxed text-ink ${
            sent ? "bg-accent-soft" : "bg-gold-soft"
          }`}
        >
          {sent ? (
            <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-ink" />
          ) : (
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          )}
          <span>
            {message}
            {sent && <> לא הגיע? בדקו גם בתיקיית הספאם.</>}
          </span>
        </p>
      )}

      <div>
        <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
          כתובת אימייל
        </label>
        <input
          id={inputId}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          placeholder="name@example.com"
          aria-describedby={hintId}
          className="mt-2 h-12 w-full rounded-full border border-line bg-surface px-5 text-base text-ink placeholder:text-muted focus-visible:border-accent"
        />
        <p id={hintId} className="mt-2 text-sm text-muted">
          פתחו את הקישור באותו דפדפן שבו ביקשתם אותו.
        </p>
      </div>

      {/* aria-disabled, not disabled: the button keeps keyboard focus while the link is sent. */}
      <button
        type="submit"
        aria-disabled={pending}
        className={`${btnPrimary} ${btnLg} ${btnBusy} w-full`}
      >
        <Send aria-hidden className="size-5 rtl:-scale-x-100" />
        {pending ? "שולחים..." : "שליחת קישור כניסה"}
      </button>
    </form>
  );
}
