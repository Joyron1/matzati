import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import type { ReactNode, Ref } from "react";

/** A text field of the settings forms (as the coupon form's). */
export const inputClass =
  "block min-h-12 w-full rounded-2xl border border-line bg-surface px-4 py-2.5 text-base text-ink placeholder:text-muted hover:border-muted aria-invalid:border-ink aria-invalid:ring-1 aria-invalid:ring-ink";

/** A small secondary button inside a field (44px target). */
export const smallButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-accent hover:text-accent-ink";

/** One field's error, linked to its control with aria-describedby. */
export function ErrorText({ id, children }: { id: string; children: ReactNode }) {
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

/** The message at the top of a rejected form; it gets focus so screen readers hear it. */
export function FormAlert({ ref, children }: { ref: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="flex items-start gap-3 rounded-2xl bg-gold-soft p-4 font-semibold text-ink"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** "מחובר" / "לא מחובר" and the like: whether a setting is live on the site now. */
export function StatusPill({ on, children }: { on: boolean; children: string }) {
  const Icon = on ? CircleCheck : CircleDashed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
        on ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-muted"
      }`}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </span>
  );
}
