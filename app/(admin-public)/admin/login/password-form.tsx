"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { CircleAlert, LogIn } from "lucide-react";
import { btnBusy, btnLg, btnPrimary } from "@/components/styles";
import type { PasswordLoginState } from "@/lib/admin/rules";
import { signInWithPassword } from "./actions";

const IDLE: PasswordLoginState = { status: "idle", message: "" };

const FIELD =
  "mt-2 h-12 w-full rounded-full border border-line bg-surface px-5 text-base text-ink placeholder:text-muted focus-visible:border-accent";

/**
 * The main way into /admin: email and password (signInWithPassword). A successful sign-in
 * redirects to /admin from the server action; a refused one keeps the email, clears the password
 * and moves focus to the message so screen readers hear it.
 */
export function PasswordLoginForm() {
  const [state, formAction, pending] = useActionState(signInWithPassword, IDLE);
  const emailId = useId();
  const passwordId = useId();
  const messageRef = useRef<HTMLParagraphElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === "idle") return;
    if (passwordRef.current) passwordRef.current.value = "";
    messageRef.current?.focus();
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      className="mt-6 flex flex-col gap-4"
    >
      {state.status !== "idle" && (
        <p
          ref={messageRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-tile bg-gold-soft px-4 py-3 text-sm leading-relaxed text-ink focus:outline-none"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>{state.message}</span>
        </p>
      )}

      <div>
        <label htmlFor={emailId} className="block text-sm font-semibold text-ink">
          אימייל
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          placeholder="name@example.com"
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor={passwordId} className="block text-sm font-semibold text-ink">
          סיסמה
        </label>
        <input
          ref={passwordRef}
          id={passwordId}
          name="password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
          className={FIELD}
        />
      </div>

      {/* aria-disabled, not disabled: the button keeps keyboard focus while signing in. */}
      <button
        type="submit"
        aria-disabled={pending}
        className={`${btnPrimary} ${btnLg} ${btnBusy} w-full`}
      >
        <LogIn aria-hidden className="size-5 rtl:-scale-x-100" />
        {pending ? "נכנסים..." : "כניסה"}
      </button>
    </form>
  );
}
