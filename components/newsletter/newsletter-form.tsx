"use client";

// The newsletter sign-up form (footer). A server action through useActionState: without
// JavaScript the form posts and the page comes back with the answer in place (progressive
// enhancement). The consent box is unchecked by default and required (the browser checks it, and
// the server again). One polite live region (role="status") announces the answer, success or
// error; after a success the fields go and focus moves to that region if it had nowhere to go.
import Link from "next/link";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { useActionState, useEffect, useId, useRef } from "react";
import { btnBusy, btnPrimary } from "@/components/styles";
import {
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_CONSENT_VALUE,
  NEWSLETTER_EMAIL_MAX,
  NEWSLETTER_FIELDS,
  NEWSLETTER_IDLE,
  NEWSLETTER_PRIVACY_HREF,
  type NewsletterFormState,
  type NewsletterSource,
} from "@/lib/newsletter/consent";

export type NewsletterAction = (
  prev: NewsletterFormState,
  formData: FormData,
) => Promise<NewsletterFormState>;

/**
 * `action` is subscribeToNewsletter (lib/newsletter/actions.ts); the dev preview passes one that
 * stores nothing, and `initial` to show a state from the start.
 */
export function NewsletterForm({
  action,
  initial = NEWSLETTER_IDLE,
  source = "footer",
}: {
  action: NewsletterAction;
  initial?: NewsletterFormState;
  source?: NewsletterSource;
}) {
  const [state, formAction, pending] = useActionState<NewsletterFormState, FormData>(
    action,
    initial,
  );
  const id = useId();
  const emailId = `${id}-email`;
  const messageId = `${id}-message`;
  const messageRef = useRef<HTMLDivElement>(null);

  const done = state.status === "subscribed";
  const emailError = state.status === "invalid_email";
  const consentError = state.status === "consent_required";

  // The success replaces the fields, and the focused button with them: continue from the message.
  useEffect(() => {
    if (!done || state === initial) return;
    const active = document.activeElement;
    if (!active || active === document.body) messageRef.current?.focus();
  }, [done, state, initial]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      className="relative space-y-4"
    >
      {!done && (
        <>
          <input type="hidden" name={NEWSLETTER_FIELDS.source} value={source} />
          {/* The honeypot: people never see or reach it (hidden from screen readers too, out of
              the tab order). A submission that fills it is answered like a success and dropped. */}
          <div aria-hidden="true" className="sr-only">
            <label>
              לא למילוי
              <input
                type="text"
                name={NEWSLETTER_FIELDS.honeypot}
                tabIndex={-1}
                autoComplete="off"
                defaultValue=""
              />
            </label>
          </div>

          <div>
            <label htmlFor={emailId} className="block text-sm font-semibold text-ink">
              כתובת אימייל
            </label>
            <input
              id={emailId}
              name={NEWSLETTER_FIELDS.email}
              type="email"
              required
              maxLength={NEWSLETTER_EMAIL_MAX}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              placeholder="name@example.com"
              defaultValue={state.email}
              aria-invalid={emailError || undefined}
              aria-describedby={emailError ? messageId : undefined}
              className="mt-2 h-12 w-full rounded-full border border-line bg-surface px-5 text-base text-ink placeholder:text-muted hover:border-muted focus-visible:border-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-gold"
            />
          </div>

          {/* The whole label is the target (44px and up); the box itself gets the focus ring. */}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink">
            <input
              type="checkbox"
              name={NEWSLETTER_FIELDS.consent}
              value={NEWSLETTER_CONSENT_VALUE}
              required
              defaultChecked={state.consent}
              aria-invalid={consentError || undefined}
              aria-describedby={consentError ? messageId : undefined}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-accent aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-offset-2 aria-[invalid=true]:outline-gold"
            />
            <span>{NEWSLETTER_CONSENT_TEXT}</span>
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            {/* aria-disabled, not disabled: the button keeps keyboard focus while sending. */}
            <button
              type="submit"
              aria-disabled={pending}
              className={`${btnPrimary} ${btnBusy} h-12 w-full px-6 text-base sm:w-auto`}
            >
              <Send aria-hidden className="size-[18px] rtl:-scale-x-100" />
              {pending ? "שולחים…" : "הרשמה לעדכונים"}
            </button>
            <p className="text-sm text-muted">
              מה נשמר ולמה:{" "}
              <Link
                href={NEWSLETTER_PRIVACY_HREF}
                className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline underline-offset-4 hover:text-ink"
              >
                מדיניות הפרטיות
              </Link>
            </p>
          </div>
        </>
      )}

      {/* Always in the page, so its content is announced when it changes. */}
      <div
        id={messageId}
        ref={messageRef}
        role="status"
        tabIndex={-1}
        className="rounded-2xl focus-visible:outline-offset-4"
      >
        {state.message &&
          (done ? (
            <p className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 font-semibold text-ink">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
                <CircleCheck aria-hidden className="size-5" />
              </span>
              {state.message}
            </p>
          ) : (
            <p className="flex items-start gap-3 rounded-2xl bg-gold-soft px-4 py-3 text-sm leading-relaxed font-semibold text-ink">
              <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
              {state.message}
            </p>
          ))}
      </div>
    </form>
  );
}
