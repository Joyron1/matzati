"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { btnBusy, btnLg, btnPrimary, btnSecondary } from "@/components/styles";
import { DEAL_TYPE_DISPLAY } from "@/lib/deals/display";
import {
  BODY_MAX,
  COUPON_MAX,
  DEAL_TYPES,
  TITLE_MAX,
  TITLE_MIN,
  type DateZone,
  type DealFormState,
  type DealFormValues,
  type FieldErrors,
} from "@/lib/deals/schema";
import { convertLocal, ISRAEL_TIME_ZONE, PACIFIC_TIME_ZONE } from "@/lib/deals/time";
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
  date_zone: "form",
};

const ZONES: Record<DateZone, { timeZone: string; label: string; hint: string }> = {
  israel: { timeZone: ISRAEL_TIME_ZONE, label: "שעון ישראל", hint: "כמו שמוצג באתר." },
  pacific: {
    timeZone: PACIFIC_TIME_ZONE,
    label: "שעון החוף המערבי",
    hint: "כמו בהודעות של אלי אקספרס. נמיר לשעון ישראל בשמירה.",
  },
};

const otherZone = (zone: DateZone): DateZone => (zone === "israel" ? "pacific" : "israel");

/** "= 10.11 בשעה 14:00 שעון החוף המערבי": a datetime-local value in the other zone. */
function inOtherZone(value: string, zone: DateZone): string | null {
  const other = ZONES[otherZone(zone)];
  const local = convertLocal(value, ZONES[zone].timeZone, other.timeZone);
  if (!local) return null;
  const [date, time] = local.split("T");
  const [, month, day] = date.split("-").map(Number);
  return `= ${day}.${month} בשעה ${time} ${other.label}`;
}

type DateField = "starts_at" | "ends_at";

/**
 * Start and end, typed in Israel time or in Pacific time (AliExpress announces its sales in
 * Pacific time), each with the same moment in the other zone underneath. The inputs submit what
 * was typed, together with the chosen zone (date_zone); parseDealForm turns each into an ISO
 * instant in one step.
 */
function DealDates({
  initial,
  initialZone,
  startRequired,
  errorFor,
}: {
  /** datetime-local values in `initialZone`. */
  initial: Record<DateField, string>;
  initialZone: DateZone;
  startRequired: boolean;
  errorFor: (field: DateField) => string | undefined;
}) {
  const [zone, setZone] = useState<DateZone>(initialZone);
  // What the inputs show, in `zone`. Kept across a rejected submit: the form stays mounted.
  const [shown, setShown] = useState(initial);

  function switchZone(next: DateZone) {
    // An incomplete or impossible value is left as typed; the server reports it.
    const move = (v: string) => convertLocal(v, ZONES[zone].timeZone, ZONES[next].timeZone) || v;
    setShown((s) => ({ starts_at: move(s.starts_at), ends_at: move(s.ends_at) }));
    setZone(next);
  }

  const fields: { name: DateField; label: string; required: boolean }[] = [
    {
      name: "starts_at",
      label: startRequired ? "מועד התחלה (חובה למבצע)" : "מועד התחלה (לא חובה)",
      required: startRequired,
    },
    { name: "ends_at", label: "מועד סיום (לא חובה)", required: false },
  ];

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3" aria-describedby="deal-dates-hint">
        <legend className="mb-2 font-semibold">באיזה שעון מקלידים</legend>
        <p id="deal-dates-hint" className="text-sm leading-relaxed text-muted">
          אלי אקספרס מודיעה על מבצעים בשעון החוף המערבי של ארה״ב. בחרו אותו כדי להקליד את השעות כמו
          בהודעה. בלי מועד סיום, הפריט נשאר באתר עד שתסירו את הפרסום.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(ZONES) as DateZone[]).map((z) => (
            <label
              key={z}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name="date_zone"
                value={z}
                checked={zone === z}
                onChange={() => switchZone(z)}
                className="mt-1 size-4 shrink-0 accent-accent focus-visible:outline-none"
              />
              <span className="space-y-1">
                <span className="block font-semibold">{ZONES[z].label}</span>
                <span className="block text-sm leading-relaxed text-muted">{ZONES[z].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map(({ name, label, required }) => {
          const other = shown[name] ? inOtherZone(shown[name], zone) : null;
          return (
            <Field key={name} name={name} label={label} error={errorFor(name)}>
              {(a11y) => (
                <>
                  <input
                    {...a11y}
                    aria-describedby={[
                      a11y["aria-describedby"],
                      `${a11y.id}-zone`,
                      "deal-dates-hint",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="datetime-local"
                    dir="ltr"
                    required={required}
                    value={shown[name]}
                    onChange={(e) => {
                      const value = e.target.value;
                      setShown((s) => ({ ...s, [name]: value }));
                    }}
                    className={input}
                  />
                  {/* Not a live region: it changes with every keystroke. The input's
                      aria-describedby reads it on focus. */}
                  <p id={`${a11y.id}-zone`} className="text-sm text-muted">
                    {other}
                  </p>
                </>
              )}
            </Field>
          );
        })}
      </div>
    </div>
  );
}

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
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      noValidate
      className="space-y-7"
    >
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

      <DealDates
        initial={{ starts_at: values.starts_at, ends_at: values.ends_at }}
        initialZone={values.date_zone === "pacific" ? "pacific" : "israel"}
        startRequired={type === "holiday"}
        errorFor={errorFor}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        {/* aria-disabled, not disabled: the button keeps keyboard focus while saving. */}
        <button
          type="submit"
          aria-disabled={pending}
          className={`${btnPrimary} ${btnLg} ${btnBusy}`}
        >
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
