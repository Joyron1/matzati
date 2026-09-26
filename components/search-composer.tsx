"use client";

import Form from "next/form";
import { Search } from "lucide-react";
import { useId, useRef, type KeyboardEvent } from "react";
import { btnLg, btnMd, btnPrimary } from "./styles";

const PLACEHOLDER = "למשל: אוזניות לריצה, עמידות למים, עד 100 ש״ח";

interface SearchComposerProps {
  variant?: "hero" | "bar";
  defaultValue?: string;
}

export function SearchComposer({ variant = "hero", defaultValue = "" }: SearchComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();
  const hintId = useId();

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
        className="flex items-center gap-2 rounded-full border border-line bg-surface p-1.5 ps-5 shadow-soft"
      >
        <label htmlFor={inputId} className="sr-only">
          מה אתם מחפשים?
        </label>
        <Search aria-hidden className="size-5 shrink-0 text-muted" />
        <input
          id={inputId}
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

  return (
    <Form
      ref={formRef}
      action="/search"
      role="search"
      className="rounded-composer border border-line bg-surface p-3 shadow-soft focus-within:border-accent sm:p-4"
    >
      <label htmlFor={inputId} className="block px-2 pt-1 text-sm font-semibold text-ink">
        מה אתם מחפשים?
      </label>
      <textarea
        id={inputId}
        name="q"
        required
        maxLength={200}
        rows={3}
        defaultValue={defaultValue}
        placeholder={PLACEHOLDER}
        onKeyDown={onKeyDown}
        aria-describedby={hintId}
        className="mt-1 block w-full resize-none bg-transparent px-2 py-1 text-lg leading-relaxed text-ink outline-none placeholder:text-muted"
      />
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p id={hintId} className="px-2 text-sm text-muted">
          אפשר לכתוב תקציב, למי זה ומה חשוב לכם.
        </p>
        <button type="submit" className={`${btnPrimary} ${btnLg} w-full sm:w-auto`}>
          <Search aria-hidden className="size-5" />
          חיפוש
        </button>
      </div>
    </Form>
  );
}
