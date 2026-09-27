"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { btnLg, btnPrimary, btnSecondary } from "@/components/styles";
import { DEAL_TYPE_DISPLAY } from "@/lib/deals/display";
import {
  BODY_MAX,
  COUPON_MAX,
  DEAL_TYPES,
  TITLE_MAX,
  TITLE_MIN,
  type DealFormState,
  type DealFormValues,
  type FieldErrors,
} from "@/lib/deals/schema";
import { saveDealAction } from "./actions";

const input =
  "block min-h-12 w-full rounded-2xl border border-line bg-surface px-4 py-2.5 text-base text-ink placeholder:text-muted hover:border-muted aria-invalid:border-ink aria-invalid:ring-1 aria-invalid:ring-ink";

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className="flex items-start gap-2 rounded-xl bg-gold-soft px-3 py-2 text-sm font-semibold text-ink"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

interface FieldProps {
  name: keyof DealFormValues;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (a11y: {
    id: string;
    name: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}

/** Label, hint and error wired to one control with htmlFor / aria-describedby. */
function Field({ name, label, hint, error, children }: FieldProps) {
  const id = `deal-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm leading-relaxed text-muted">
          {hint}
        </p>
      )}
      {children({
        id,
        name,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {error && <ErrorText id={`${id}-error`}>{error}</ErrorText>}
    </div>
  );
}

// Form field → the DealInput field its error is reported on.
const ERROR_KEY: Record<keyof DealFormValues, keyof FieldErrors> = {
  type: "type",
  title: "title",
  body: "body",
  product: "product_id",
  coupon_code: "coupon_code",
  starts_at: "starts_at",
  ends_at: "ends_at",
};

export function DealForm({ dealId, initial }: { dealId: string | null; initial: DealFormValues }) {
  const action = useMemo(() => saveDealAction.bind(null, dealId), [dealId]);
  const [state, formAction, pending] = useActionState<DealFormState, FormData>(action, {
    values: initial,
    errors: {},
  });
  const [type, setType] = useState(initial.type);
  const summaryRef = useRef<HTMLDivElement>(null);

  const { values, errors } = state;
  const errorFor = (field: keyof DealFormValues) => errors[ERROR_KEY[field]];
  const fieldErrorCount = Object.keys(errors).filter((k) => k !== "form").length;

  // After a rejected submit, move focus to the summary so screen readers hear what to fix.
  useEffect(() => {
    if (Object.keys(state.errors).length) summaryRef.current?.focus();
  }, [state]);

  return (
    // Inputs are uncontrolled with defaultValue from the last submit: React resets the form after
    // the action, and a rejected form comes back with what the admin typed.
    <form action={formAction} noValidate className="space-y-7">
      {(errors.form || fieldErrorCount > 0) && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-2xl bg-gold-soft p-4 text-ink"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="space-y-1">
            {errors.form && <p className="font-semibold">{errors.form}</p>}
            {fieldErrorCount > 0 && (
              <p className="font-semibold">
                {fieldErrorCount === 1
                  ? "יש שדה אחד לתקן. הוא מסומן למטה."
                  : `יש ${fieldErrorCount} שדות לתקן. הם מסומנים למטה.`}
              </p>
            )}
          </div>
        </div>
      )}

      <fieldset
        className="space-y-3"
        aria-describedby={errorFor("type") ? "deal-type-error" : undefined}
      >
        <legend className="mb-3 font-semibold">סוג</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {DEAL_TYPES.map((t) => {
            const { formLabel, formHint, Icon } = DEAL_TYPE_DISPLAY[t];
            return (
              <label
                key={t}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name="type"
                  value={t}
                  defaultChecked={values.type === t}
                  onChange={() => setType(t)}
                  className="mt-1 size-4 shrink-0 accent-accent focus-visible:outline-none"
                />
                <span className="space-y-1">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Icon aria-hidden className="size-4" />
                    {formLabel}
                  </span>
                  <span className="block text-sm leading-relaxed text-muted">{formHint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errorFor("type") && <ErrorText id="deal-type-error">{errorFor("type")}</ErrorText>}
      </fieldset>

      <Field
        name="title"
        label="כותרת"
        hint={`בין ${TITLE_MIN} ל־${TITLE_MAX} תווים.`}
        error={errorFor("title")}
      >
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            required
            minLength={TITLE_MIN}
            maxLength={TITLE_MAX}
            defaultValue={values.title}
            className={input}
          />
        )}
      </Field>

      <Field
        name="body"
        label="תיאור (לא חובה)"
        hint={`עד ${BODY_MAX.toLocaleString("en-US")} תווים. מספרים כמו מחיר, משוב ומכירות רק כפי שהם מופיעים באלי אקספרס.`}
        error={errorFor("body")}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            rows={4}
            maxLength={BODY_MAX}
            defaultValue={values.body}
            className={`${input} leading-relaxed`}
          />
        )}
      </Field>

      <Field
        name="product"
        label="מוצר באלי אקספרס (לא חובה)"
        hint="מספר המוצר או קישור לדף המוצר. בשמירה נביא את פרטי המוצר מאלי אקספרס, והכרטיס יקשר לדף המוצר אצלנו."
        error={errorFor("product")}
      >
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            dir="ltr"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://he.aliexpress.com/item/…"
            defaultValue={values.product}
            className={input}
          />
        )}
      </Field>

      <Field
        name="coupon_code"
        label="קוד קופון (לא חובה)"
        hint={`אותיות באנגלית, ספרות, מקף וקו תחתון. עד ${COUPON_MAX} תווים.`}
        error={errorFor("coupon_code")}
      >
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={COUPON_MAX}
            defaultValue={values.coupon_code}
            className={`${input} tracking-wider`}
          />
        )}
      </Field>

      <div className="space-y-2">
        <p id="deal-dates-hint" className="text-sm leading-relaxed text-muted">
          התאריכים בשעון ישראל. בלי מועד סיום, הפריט נשאר באתר עד שתסירו את הפרסום.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="starts_at"
            label={type === "holiday" ? "מועד התחלה (חובה למבצע)" : "מועד התחלה (לא חובה)"}
            error={errorFor("starts_at")}
          >
            {(a11y) => (
              <input
                {...a11y}
                aria-describedby={[a11y["aria-describedby"], "deal-dates-hint"]
                  .filter(Boolean)
                  .join(" ")}
                type="datetime-local"
                dir="ltr"
                required={type === "holiday"}
                defaultValue={values.starts_at}
                className={input}
              />
            )}
          </Field>
          <Field name="ends_at" label="מועד סיום (לא חובה)" error={errorFor("ends_at")}>
            {(a11y) => (
              <input
                {...a11y}
                aria-describedby={[a11y["aria-describedby"], "deal-dates-hint"]
                  .filter(Boolean)
                  .join(" ")}
                type="datetime-local"
                dir="ltr"
                defaultValue={values.ends_at}
                className={input}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <button type="submit" disabled={pending} className={`${btnPrimary} ${btnLg}`}>
          {pending ? "שומרים…" : "שמירה"}
        </button>
        <Link href="/admin" className={`${btnSecondary} ${btnLg}`}>
          ביטול
        </Link>
        <p aria-live="polite" className="sr-only">
          {pending ? "שומרים את הדיל" : ""}
        </p>
      </div>
    </form>
  );
}
