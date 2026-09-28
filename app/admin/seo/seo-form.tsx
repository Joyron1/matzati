"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { btnBusy, btnLg, btnPrimary, btnSecondary } from "@/components/styles";
import { searchHref } from "@/lib/search-url";
import {
  INTRO_MAX,
  QUERY_MAX,
  TITLE_MAX,
  TITLE_MIN,
  type SeoFieldErrors,
  type SeoFormState,
  type SeoFormValues,
} from "@/lib/seo/schema";
import { normalizeSlugInput, SLUG_MAX_LENGTH, slugFromQuery } from "@/lib/seo/slug";
import { saveSeoPageAction } from "./actions";

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

type TextField = keyof Omit<SeoFormValues, "published">;

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
  const id = `seo-${name}`;
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

/**
 * Create / edit form for a landing page. `originalSlug` is null for a new page. The slug follows
 * the query as it is typed (slugFromQuery) until the admin edits the slug field; an existing
 * page keeps its slug unless the admin changes it.
 */
export function SeoForm({
  originalSlug,
  initial,
}: {
  originalSlug: string | null;
  initial: SeoFormValues;
}) {
  const action = useMemo(() => saveSeoPageAction.bind(null, originalSlug), [originalSlug]);
  const [state, formAction, pending] = useActionState<SeoFormState, FormData>(action, {
    values: initial,
    errors: {},
  });
  const [query, setQuery] = useState(initial.query);
  const [slug, setSlug] = useState(initial.slug);
  // A new page's slug follows the query until the admin types one of their own.
  const [slugTouched, setSlugTouched] = useState(originalSlug !== null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const { values, errors } = state;
  const errorFor = (field: keyof SeoFieldErrors) => errors[field];
  const fieldErrorCount = Object.keys(errors).filter((k) => k !== "form").length;
  const previewSlug = normalizeSlugInput(slug) || slugFromQuery(query);

  // After a rejected submit, move focus to the summary so screen readers hear what to fix.
  useEffect(() => {
    if (Object.keys(state.errors).length) summaryRef.current?.focus();
  }, [state]);

  return (
    // Query and slug are controlled (the slug follows the query); the other inputs are
    // uncontrolled with defaultValue from the last submit, as in the deals form.
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

      <Field
        name="query"
        label="החיפוש"
        hint={
          <>
            כמו שמבקרים כותבים אותו, עד {QUERY_MAX} תווים. הדף מריץ את החיפוש הזה ומציג את התוצאות
            שעברו את הסינון. כדאי לבדוק קודם ב
            <Link
              href={query.trim() ? searchHref({ q: query.trim() }) : "/"}
              target="_blank"
              className="font-semibold text-accent-ink underline underline-offset-4"
            >
              חיפוש באתר
              <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
            </Link>{" "}
            שיש לו תוצאות.
          </>
        }
        error={errorFor("query")}
      >
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            required
            maxLength={QUERY_MAX}
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!slugTouched) setSlug(slugFromQuery(e.target.value));
            }}
            className={input}
          />
        )}
      </Field>

      <Field
        name="title_he"
        label="כותרת הדף"
        hint={`בין ${TITLE_MIN} ל־${TITLE_MAX} תווים. מופיעה בראש הדף ובתוצאות של מנועי חיפוש.`}
        error={errorFor("title_he")}
      >
        {(a11y) => (
          <input
            {...a11y}
            type="text"
            required
            minLength={TITLE_MIN}
            maxLength={TITLE_MAX}
            defaultValue={values.title_he}
            className={input}
          />
        )}
      </Field>

      <Field
        name="intro_he"
        label="פתיח (לא חובה)"
        hint={`עד ${INTRO_MAX} תווים, מופיע מתחת לכותרת ובתיאור בתוצאות החיפוש. בלי מחירים ומספרים: המספרים בדף מגיעים מאלי אקספרס.`}
        error={errorFor("intro_he")}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            rows={4}
            maxLength={INTRO_MAX}
            defaultValue={values.intro_he}
            className={`${input} leading-relaxed`}
          />
        )}
      </Field>

      <Field
        name="slug"
        label="כתובת הדף"
        hint={
          <>
            נוצרת מהחיפוש, ואפשר לשנות. אותיות בעברית, אותיות באנגלית, ספרות ומקפים, עד{" "}
            {SLUG_MAX_LENGTH} תווים.
            {originalSlug !== null && " שינוי הכתובת של דף מפורסם שובר קישורים קיימים אליו."}
          </>
        }
        error={errorFor("slug")}
      >
        {(a11y) => (
          <>
            <input
              {...a11y}
              type="text"
              dir="auto"
              autoComplete="off"
              spellCheck={false}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(e.target.value.trim() !== "");
              }}
              className={input}
            />
            {previewSlug && (
              <p className="text-sm text-muted">
                הדף יהיה בכתובת: <bdi dir="ltr">/s/{previewSlug}</bdi>
              </p>
            )}
          </>
        )}
      </Field>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent">
        <input
          type="checkbox"
          name="published"
          defaultChecked={values.published}
          className="mt-1 size-5 shrink-0 accent-accent focus-visible:outline-none"
        />
        <span className="space-y-1">
          <span className="block font-semibold">לפרסם באתר</span>
          <span className="block text-sm leading-relaxed text-muted">
            דף מפורסם מופיע בדף הבית, במפת האתר ובמנועי חיפוש. התוצאות שלו נשמרות מיד אחרי הפרסום
            ומתעדכנות פעם בשבוע. טיוטה נראית רק כאן.
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
        <Link href="/admin/seo" className={`${btnSecondary} ${btnLg}`}>
          ביטול
        </Link>
        <p aria-live="polite" className="sr-only">
          {pending ? "שומרים את הדף" : ""}
        </p>
      </div>
    </form>
  );
}
