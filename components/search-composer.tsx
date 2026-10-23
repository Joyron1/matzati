"use client";

import Form from "next/form";
import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";
import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { keepPricesTogether } from "@/lib/format";
import type { SearchMode } from "@/lib/types";
import { AgentSwitch } from "./agent-switch";
import {
  ImageSearch,
  LinkSearch,
  looksLikeLink,
  ModeTabs,
  type InputMode,
} from "./search-input-modes";
import { btnLg, btnMd, btnPrimary } from "./styles";

// FULL_EXAMPLE of components/search-guide.tsx, the home example chosen on the snapshots.
const PLACEHOLDER = keepPricesTogether("למשל: שעון חכם עם מד דופק עד 150 ש״ח");

/** The home page field's id, so the "איך לחפש" examples can add text to it (AddToSearch). */
export const COMPOSER_INPUT_ID = "composer-q";

interface SearchComposerProps {
  variant?: "hero" | "bar";
  defaultValue?: string;
  /** The mode of the page's search (/search?mode=), so the "סוכן חכם" switch starts as it is. */
  mode?: SearchMode;
}

export function SearchComposer({
  variant = "hero",
  defaultValue = "",
  mode = "smart",
}: SearchComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const barInputId = useId();
  const hintId = useId();
  const noteId = useId();
  // Words, a product link or a photo (owner request 2026-10-23); a pasted link switches to "קישור".
  const [how, setHow] = useState<InputMode>("text");
  const [pasted, setPasted] = useState("");

  function onPaste(e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text");
    if (!e.currentTarget.value.trim() && looksLikeLink(text)) {
      e.preventDefault();
      setPasted(text.trim());
      setHow("link");
    }
  }

  // Enter searches, Shift+Enter adds a line.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  if (variant === "bar") {
    const tabs = <ModeTabs value={how} onChange={setHow} compact />;
    if (how !== "text") {
      return (
        <div className="space-y-2">
          {tabs}
          {how === "link" ? (
            <LinkSearch key={pasted} variant="bar" initial={pasted} />
          ) : (
            <ImageSearch variant="bar" />
          )}
        </div>
      );
    }
    return (
      <Form ref={formRef} action="/search" role="search" className="space-y-1">
        {tabs}
        <div
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
            onPaste={onPaste}
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
          />
          <button type="submit" className={`${btnPrimary} ${btnMd}`}>
            חיפוש
          </button>
        </div>
        {/* Keyed by the mode, so a page of the other mode starts the switch as that page is. */}
        <AgentSwitch key={mode} defaultOn={mode !== "simple"} className="ps-2" />
      </Form>
    );
  }

  // Home page hero: the page's one focal point, a card with a visible label, the field and the
  // "חיפוש" button. The field is a box of its own inside the card (an inset tint, a border that
  // darkens on hover and turns cobalt with the site focus ring on focus), with a caret at its start
  // while it is empty and not focused (blinking, still under reduced motion). A cobalt border that
  // turns slowly a few times after the page loads (never under reduced motion) and a soft cobalt
  // glow set the card apart (.composer-frame and .composer-caret in globals.css).
  return (
    <div className="space-y-3">
      <div className="composer-frame">
        <div className="rounded-[calc(var(--radius-composer)_-_2px)] bg-surface p-3 text-start sm:p-4">
          <div className="pb-3">
            <ModeTabs value={how} onChange={setHow} />
          </div>
          {how === "link" && <LinkSearch key={pasted} variant="hero" initial={pasted} />}
          {how === "image" && <ImageSearch variant="hero" />}
          <Form ref={formRef} action="/search" role="search" hidden={how !== "text"}>
            <label
              htmlFor={COMPOSER_INPUT_ID}
              className="flex items-center gap-2 px-1 pb-2.5 text-lg font-bold text-ink sm:px-1.5"
            >
              <Search
                aria-hidden
                className="size-[22px] shrink-0 text-accent-ink"
                strokeWidth={2.5}
              />
              מה אתם מחפשים?
            </label>
            <div className="relative">
              <textarea
                id={COMPOSER_INPUT_ID}
                name="q"
                required
                maxLength={200}
                rows={2}
                defaultValue={defaultValue}
                placeholder={PLACEHOLDER}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                // The keyboard's Enter key reads "search", which is what Enter does here.
                enterKeyHint="search"
                aria-describedby={`${hintId} ${noteId}`}
                // 22px and up, so phones never zoom in on focus. Grows with the text where
                // field-sizing is supported; 2 rows elsewhere. The site focus ring (globals.css).
                className="block max-h-60 min-h-[6.5rem] w-full resize-none rounded-2xl border-2 border-muted/70 bg-bg px-4 py-3 text-[1.375rem] leading-relaxed text-ink field-sizing-content placeholder:text-muted hover:border-muted focus-visible:border-accent sm:min-h-[7rem] sm:px-5 sm:py-3.5 sm:text-[1.625rem]"
              />
              <span aria-hidden className="composer-caret" />
            </div>
            <AgentSwitch className="mt-2 sm:ps-0.5" />
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:ps-1.5">
              {/* Hidden on phones to keep the button in view; still read as the field's description. */}
              <p id={hintId} className="hidden text-sm text-muted sm:block">
                אפשר לכתוב תקציב, למי זה ומה חשוב לכם.
              </p>
              {/* The page's primary action: full width on phones, where the thumb reaches it. */}
              <button
                type="submit"
                className={`${btnPrimary} ${btnLg} w-full text-lg font-bold shadow-[0_12px_24px_-12px_var(--accent)] sm:w-auto sm:px-9`}
              >
                <Search aria-hidden className="size-5" strokeWidth={2.5} />
                חיפוש
              </button>
            </div>
          </Form>
        </div>
      </div>
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
