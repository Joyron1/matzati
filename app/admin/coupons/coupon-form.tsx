"use client";

import Link from "next/link";
import { CircleAlert, Package, Store, type LucideIcon } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { btnBusy, btnLg, btnPrimary, btnSecondary } from "@/components/styles";
import {
  CODE_MAX,
  COUPON_SCOPES,
  TERMS_MAX,
  TITLE_MAX,
  TITLE_MIN,
  type CouponFieldErrors,
  type CouponFormState,
  type CouponFormValues,
} from "@/lib/coupons/schema";
import type { CouponScope } from "@/lib/coupons/types";
import { saveCouponAction } from "./actions";
import type { SaleOption } from "./sale-options";

const input =
  "block min-h-12 w-full rounded-2xl border border-line bg-surface px-4 py-2.5 text-base text-ink placeholder:text-muted hover:border-muted aria-invalid:border-ink aria-invalid:ring-1 aria-invalid:ring-ink";

const SCOPE_DISPLAY: Record<CouponScope, { label: string; hint: string; Icon: LucideIcon }> = {
  sitewide: {
    label: "לכל האתר",
    hint: "קוד שעובד על הזמנות באלי אקספרס בלי קשר למוצר. מופיע בדף הקופונים.",
    Icon: Store,
  },
  product: {
    label: "למוצר אחד",
    hint: "קוד שעובד על מוצר מסוים. מופיע גם בדף המוצר אצלנו.",
    Icon: Package,
  },
};

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

type TextField = Exclude<keyof CouponFormValues, "featured" | "scope">;

interface FieldProps {
  name: TextField;
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
  const id = `coupon-${name}`;
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

// Form field → the CouponInput field its error is reported on.
const ERROR_KEY: Record<keyof CouponFormValues, keyof CouponFieldErrors> = {
  code: "code",
  title: "title",
  terms: "terms",
  min_spend: "min_spend_ils",
  scope: "scope",
  product: "product_id",
  sale_id: "sale_id",
  starts_at: "starts_at",
  ends_at: "ends_at",
  featured: "featured",
};

const checkCard =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent";

export function CouponForm({
  couponId,
  initial,
  sales,
}: {
  couponId: string | null;
  initial: CouponFormValues;
  /** Null when the sales could not be loaded. */
  sales: SaleOption[] | null;
}) {
  const action = useMemo(() => saveCouponAction.bind(null, couponId), [couponId]);
  const [state, formAction, pending] = useActionState<CouponFormState, FormData>(action, {
    values: initial,
    errors: {},
  });
  const [scope, setScope] = useState(initial.scope);
  const summaryRef = useRef<HTMLDivElement>(null);

  const { values, errors } = state;
  const errorFor = (field: keyof CouponFormValues) => errors[ERROR_KEY[field]];
  const fieldErrorCount = Object.keys(errors).filter((k) => k !== "form").length;
  // A linked sale that is not in the list (no longer a holiday, or the list failed to load) stays
  // selectable, so the form does not silently drop it; saving then checks it again.
  const saleOptions = sales ?? [];
  const saleMissing = values.sale_id !== "" && !saleOptions.some((s) => s.id === values.sale_id);

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
        aria-describedby={errorFor("scope") ? "coupon-scope-error" : undefined}
      >
        <legend className="mb-3 font-semibold">על מה הקופון</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {COUPON_SCOPES.map((s) => {
            const { label, hint, Icon } = SCOPE_DISPLAY[s];
            return (
              <label key={s} className={checkCard}>
                <input
                  type="radio"
                  name="scope"
                  value={s}
                  defaultChecked={values.scope === s}
                  onChange={() => setScope(s)}
                  className="mt-1 size-4 shrink-0 accent-accent focus-visible:outline-none"
                />
                <span className="space-y-1">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Icon aria-hidden className="size-4" />
                    {label}
                  </span>
                  <span className="block text-sm leading-relaxed text-muted">{hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errorFor("scope") && <ErrorText id="coupon-scope-error">{errorFor("scope")}</ErrorText>}
      </fieldset>

      {/* Hidden rather than removed for a sitewide coupon, so switching back keeps what was typed;
          the server ignores it for a sitewide coupon. */}
      <div hidden={scope !== "product"}>
        <Field
          name="product"
          label="המוצר באלי אקספרס"
          hint="מספר המוצר או קישור לדף המוצר. בשמירה נביא את פרטי המוצר מאלי אקספרס, והקופון יקשר לדף המוצר אצלנו."
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
              required={scope === "product"}
              placeholder="https://he.aliexpress.com/item/…"
              defaultValue={values.product}
              className={input}
            />
          )}
        </Field>
      </div>

      <Field
        name="code"
        label="קוד הקופון"
        hint={`בדיוק כמו שמזינים אותו בקופה: אותיות באנגלית, ספרות, מקף וקו תחתון. עד ${CODE_MAX} תווים.`}
        error={errorFor("code")}
      >
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            dir="ltr"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={CODE_MAX}
            defaultValue={values.code}
            className={`${input} font-mono tracking-wider`}
          />
        )}
      </Field>

      <Field
        name="title"
        label="כותרת"
        hint={`בין ${TITLE_MIN} ל־${TITLE_MAX} תווים, למשל ״₪5 הנחה״ (לסכום המינימום יש שדה משלו). רק מה שכתוב בתנאי הקופון.`}
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
        name="min_spend"
        label="הזמנה מינימלית בשקלים (לא חובה)"
        hint="כמו בתנאי הקופון, למשל 40 או 39.90. השאירו ריק אם אין מינימום."
        error={errorFor("min_spend")}
      >
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            placeholder="40"
            defaultValue={values.min_spend}
            className={`${input} sm:max-w-60`}
          />
        )}
      </Field>

      <Field
        name="terms"
        label="תנאי הקופון (לא חובה)"
        hint={`עד ${TERMS_MAX.toLocaleString("en-US")} תווים. למשל: למשתמשים חדשים בלבד, מוגבל בכמות, רק באפליקציה.`}
        error={errorFor("terms")}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            rows={4}
            maxLength={TERMS_MAX}
            defaultValue={values.terms}
            className={`${input} leading-relaxed`}
          />
        )}
      </Field>

      <Field
        name="sale_id"
        label="מבצע (לא חובה)"
        hint="קופון של מבצע גדול מופיע גם בכרטיס של המבצע. המבצעים נוספים בניהול הדילים, בסוג ״חג או מבצע״."
        error={errorFor("sale_id")}
      >
        {(a11y) => (
          <select {...a11y} defaultValue={values.sale_id} className={input}>
            <option value="">ללא מבצע</option>
            {saleOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            {saleMissing && (
              <option value={values.sale_id}>
                {sales === null ? "המבצע המקושר" : "מבצע שלא נמצא ברשימת המבצעים"}
              </option>
            )}
          </select>
        )}
      </Field>

      <div className="space-y-2">
        <p id="coupon-dates-hint" className="text-sm leading-relaxed text-muted">
          התאריכים בשעון ישראל. בלי מועד התחלה, הקופון בתוקף מרגע הפרסום. בלי מועד סיום, הוא נשאר
          באתר עד שתסירו את הפרסום.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="starts_at" label="מועד התחלה (לא חובה)" error={errorFor("starts_at")}>
            {(a11y) => (
              <input
                {...a11y}
                aria-describedby={[a11y["aria-describedby"], "coupon-dates-hint"]
                  .filter(Boolean)
                  .join(" ")}
                type="datetime-local"
                dir="ltr"
                defaultValue={values.starts_at}
                className={input}
              />
            )}
          </Field>
          <Field name="ends_at" label="מועד סיום (לא חובה)" error={errorFor("ends_at")}>
            {(a11y) => (
              <input
                {...a11y}
                aria-describedby={[a11y["aria-describedby"], "coupon-dates-hint"]
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

      <label className={checkCard}>
        <input
          type="checkbox"
          name="featured"
          defaultChecked={values.featured}
          className="mt-1 size-5 shrink-0 accent-accent focus-visible:outline-none"
        />
        <span className="space-y-1">
          <span className="block font-semibold">קופון מומלץ</span>
          <span className="block text-sm leading-relaxed text-muted">
            מופיע ראשון בדף הקופונים. קופון מומלץ לכל האתר מופיע גם בדפי המוצרים.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        {/* aria-disabled, not disabled: the button keeps keyboard focus while saving. */}
        <button
          type="submit"
          aria-disabled={pending}
          className={`${btnPrimary} ${btnLg} ${btnBusy}`}
        >
          {pending ? "שומרים…" : "שמירה"}
        </button>
        <Link href="/admin/coupons" className={`${btnSecondary} ${btnLg}`}>
          ביטול
        </Link>
        <p aria-live="polite" className="sr-only">
          {pending ? "שומרים את הקופון" : ""}
        </p>
      </div>
    </form>
  );
}
