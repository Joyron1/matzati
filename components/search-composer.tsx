"use client";

import Form from "next/form";
import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";
import { useId, useRef, type KeyboardEvent } from "react";
import { keepPricesTogether } from "@/lib/format";
import { btnLg, btnMd, btnPrimary } from "./styles";

const PLACEHOLDER = keepPricesTogether("למשל: אוזניות לריצה, עמידות למים, עד 100 ש״ח");

/** The home page field's id, so the "איך לחפש" examples can add text to it (AddToSearch). */
export const COMPOSER_INPUT_ID = "composer-q";

interface SearchComposerProps {
  variant?: "hero" | "bar";
  defaultValue?: string;
}

export function SearchComposer({ variant = "hero", defaultValue = "" }: SearchComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const barInputId = useId();
  const hintId = useId();
  const noteId = useId();

  // Enter searches, Shift+Enter adds a line.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  if (variant === "bar") {
    return (
      <Form
        ref={formRef}
        action="/search"
        role="search"
        // The field has no outline of its own; the pill takes the site focus ring (globals.css).
        className="flex items-center gap-2 rounded-full border border-line bg-surface p-1.5 ps-5 shadow-soft has-[input:focus-visible]:border-accent has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent"
      >
        <label htmlFor={barInputId} className="sr-only">
          מה אתם מחפשים?
        </label>
        <Search aria-hidden className="size-5 shrink-0 text-muted" />
        <input
          id={barInputId}
          name="q"
          type="search"
          required
          maxLength={200}
          defaultValue={defaultValue}
          placeholder={PLACEHOLDER}
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
        <button type="submit" className={`${btnPrimary} ${btnMd}`}>
          חיפוש
        </button>
      </Form>
    );
  }

  // Home page hero: the page's one focal point. The whole box reads as the field (it takes the
  // site focus ring), with a visible label, a search icon and the "חיפוש" button inside it.
  return (
    <div className="space-y-3">
      <Form
        ref={formRef}
        action="/search"
        role="search"
        className="rounded-composer border border-line bg-surface p-2 text-start shadow-soft has-[textarea:focus-visible]:border-accent has-[textarea:focus-visible]:outline-3 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-accent sm:p-3"
      >
        <label
          htmlFor={COMPOSER_INPUT_ID}
          className="flex items-center gap-2 px-3 pt-2.5 text-base font-bold text-ink sm:px-4 sm:pt-3"
        >
          <Search aria-hidden className="size-5 shrink-0 text-accent-ink" strokeWidth={2.25} />
          מה אתם מחפשים?
        </label>
        <textarea
          id={COMPOSER_INPUT_ID}
          name="q"
          required
          maxLength={200}
          rows={2}
          defaultValue={defaultValue}
          placeholder={PLACEHOLDER}
          onKeyDown={onKeyDown}
          // The keyboard's Enter key reads "search", which is what Enter does here.
          enterKeyHint="search"
          aria-describedby={`${hintId} ${noteId}`}
          // Grows with the text where field-sizing is supported; 2 rows elsewhere.
          className="mt-1 block max-h-48 min-h-[4.75rem] w-full resize-none bg-transparent px-3 py-1 text-lg leading-relaxed text-ink outline-none field-sizing-content placeholder:text-muted sm:px-4 sm:text-xl"
        />
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:ps-4">
          {/* Hidden on phones to keep the button in view; still read as the field's description. */}
          <p id={hintId} className="hidden text-sm text-muted sm:block">
            אפשר לכתוב תקציב, למי זה ומה חשוב לכם.
          </p>
          <button type="submit" className={`${btnPrimary} ${btnLg} w-full text-lg sm:w-auto`}>
            <Search aria-hidden className="size-5" />
            חיפוש
          </button>
        </div>
      </Form>
      {/* Said before searching: the query itself may be shown to other visitors. */}
      <p
        id={noteId}
        className="px-3 text-center text-[13px] leading-relaxed text-balance text-muted"
      >
        {/* Inline, so the icon stays with the first word when the centered note wraps. */}
        <ShieldCheck aria-hidden className="me-1.5 inline size-3.5 align-[-2px]" />
        חיפושים שמצאו מוצרים מופיעים ב
        <Link
          href="/searches"
          className="whitespace-nowrap underline underline-offset-4 hover:text-ink"
        >
          חיפושים האחרונים
        </Link>
        , בלי פרטים על מי שחיפש. אל תכתבו פרטים אישיים.
      </p>
    </div>
  );
}
