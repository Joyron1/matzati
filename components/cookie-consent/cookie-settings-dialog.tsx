"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { btnPrimary, btnSecondary } from "@/components/styles";
import { LEGAL_PATHS } from "@/lib/config/legal";
import { CONSENT_CATEGORIES, type ConsentCategoryInfo } from "@/lib/consent/categories";
import {
  ACCEPT_ALL,
  NECESSARY_ONLY,
  type ConsentChoice,
  type ConsentState,
} from "@/lib/consent/consent";
import styles from "./cookie-consent.module.css";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled])";

/**
 * Keeps Tab inside the open dialog: from the last control back to the first and the other way.
 * showModal() already makes the page behind it inert; this also keeps focus off the browser's own
 * toolbar between rounds.
 */
function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * "הגדרות עוגיות": a native modal <dialog>. showModal() moves focus to its first control (the
 * close button) and makes the page inert; Esc closes it (the native cancel), and so do the close
 * button and every choice. On close, ConsentManager returns focus to the button that opened it.
 * `categories`: consentCategories() for the page (statistics in use while Google Analytics is
 * configured, marketing while the Meta Pixel is).
 */
export function CookieSettingsDialog({
  open,
  categories = CONSENT_CATEGORIES,
  consent,
  onSave,
  onLeave,
  onClose,
}: {
  open: boolean;
  categories?: readonly ConsentCategoryInfo[];
  consent: ConsentState | null | undefined;
  onSave(choice: ConsentChoice): void;
  /** The policy link is being followed in this tab (called just before the dialog closes). */
  onLeave(): void;
  /** After the dialog has closed, however it closed (the native close event). */
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={onClose}
      onKeyDown={trapTab}
      className={`mx-0 mt-auto mb-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-card border border-line bg-surface p-0 text-ink backdrop:bg-ink/45 dark:backdrop:bg-bg/75 sm:m-auto sm:w-[34rem] sm:max-w-[calc(100%-2rem)] sm:rounded-card ${styles.dialogIn}`}
    >
      {/* The content mounts on every opening, so the switches start from the stored choice. */}
      {open && (
        <SettingsContent
          categories={categories}
          consent={consent}
          titleId={titleId}
          descriptionId={descriptionId}
          onSave={(choice) => {
            onSave(choice);
            close();
          }}
          onLeave={onLeave}
          onDismiss={close}
        />
      )}
    </dialog>
  );
}

function SettingsContent({
  categories,
  consent,
  titleId,
  descriptionId,
  onSave,
  onLeave,
  onDismiss,
}: {
  categories: readonly ConsentCategoryInfo[];
  consent: ConsentState | null | undefined;
  titleId: string;
  descriptionId: string;
  onSave(choice: ConsentChoice): void;
  onLeave(): void;
  onDismiss(): void;
}) {
  const [draft, setDraft] = useState<ConsentChoice>(() => ({
    analytics: consent?.analytics === true,
    marketing: consent?.marketing === true,
  }));

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line py-3 ps-5 pe-3">
        <h2 id={titleId} className="pt-2 font-display text-2xl">
          הגדרות עוגיות
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="סגירה"
          className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X aria-hidden className="size-5" strokeWidth={2} />
        </button>
      </div>

      <div className="px-5 pt-4 pb-2">
        <p id={descriptionId} className="text-sm leading-relaxed text-muted">
          בחרו אילו סוגי עוגיות ואחסון בדפדפן מותר לנו להפעיל. אפשר לשנות את הבחירה בכל עת דרך
          ״הגדרות עוגיות״ בתחתית כל עמוד.
        </p>
        <ul className="mt-2 divide-y divide-line">
          {categories.map((info) => (
            <CategoryRow
              key={info.id}
              info={info}
              checked={info.id === "necessary" || draft[info.id]}
              onChange={(checked) => {
                const id = info.id;
                if (id !== "necessary") setDraft((current) => ({ ...current, [id]: checked }));
              }}
            />
          ))}
        </ul>
        <p className="py-2 text-sm">
          <Link
            href={LEGAL_PATHS.cookies}
            onClick={(event) => {
              // Followed in this tab (not a new tab or window): the page changes behind the dialog.
              const newTab = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
              if (event.button === 0 && !newTab) onLeave();
              onDismiss();
            }}
            className="inline-flex min-h-11 items-center font-medium text-accent-ink underline underline-offset-4 hover:no-underline"
          >
            למדיניות העוגיות המלאה
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => onSave(draft)}
          className={`${btnPrimary} min-h-11 grow px-5 text-sm sm:grow-0`}
        >
          שמירת הבחירה
        </button>
        <button
          type="button"
          onClick={() => onSave(NECESSARY_ONLY)}
          className={`${btnSecondary} min-h-11 grow px-4 text-sm sm:grow-0`}
        >
          אישור הכרחיות בלבד
        </button>
        <button
          type="button"
          onClick={() => onSave(ACCEPT_ALL)}
          className={`${btnSecondary} min-h-11 grow px-4 text-sm sm:grow-0`}
        >
          אישור הכול
        </button>
      </div>
    </>
  );
}

function CategoryRow({
  info,
  checked,
  onChange,
}: {
  info: ConsentCategoryInfo;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  const labelId = useId();
  const statusId = useId();
  const descriptionId = useId();
  const always = info.id === "necessary";
  // The switch is named by the category alone; the tag and the description describe it.
  const status = always ? "תמיד פעילות" : info.inUse ? "" : "לא בשימוש כרגע";
  return (
    <li className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          <span id={labelId}>{info.label}</span>{" "}
          {status && (
            <span
              id={statusId}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                always ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-muted"
              }`}
            >
              {status}
            </span>
          )}
        </h3>
        <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted">
          {info.description}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={always}
        labelledBy={labelId}
        describedBy={status ? `${statusId} ${descriptionId}` : descriptionId}
        onChange={onChange}
      />
    </li>
  );
}

/**
 * A native checkbox with role="switch", drawn as a switch. The invisible input covers the whole
 * 56x44 target; the track shows its focus ring. In RTL the knob sits at the start (right) when off.
 */
function Switch({
  checked,
  disabled,
  labelledBy,
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  labelledBy: string;
  describedBy: string;
  onChange(checked: boolean): void;
}) {
  return (
    <span className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className="pointer-events-none h-7 w-12 rounded-full border-2 border-muted bg-surface peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-60"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-muted peer-checked:start-[1.875rem] peer-checked:bg-on-accent peer-disabled:opacity-80"
      />
    </span>
  );
}
