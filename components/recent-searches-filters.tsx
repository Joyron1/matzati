"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useTransition, type FormEvent, type MouseEvent } from "react";
import { cleanRecentText, recentHref } from "@/lib/recent/params";
import { RECENT_TEXT_MAX, type RecentCategory } from "@/lib/recent/types";
import { btnMd, btnSecondary } from "./styles";

const DEBOUNCE_MS = 300;

const PILL = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold";

interface RecentSearchesFiltersProps {
  categories: RecentCategory[];
  /** Active category id from the URL. */
  category?: string;
  /** Active free text from the URL. */
  text?: string;
}

/**
 * Category pills and the free-text filter of /searches. The text form is a plain GET form that
 * works without JavaScript; with it, the list also filters while typing (debounced).
 */
export function RecentSearchesFilters({ categories, category, text }: RecentSearchesFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // What was last asked for, not what the URL said when the key was pressed: the props change only
  // once a navigation commits, and a debounced call must not compare against (or rebuild the URL
  // from) a value that a pending navigation is about to replace.
  const requested = useRef(text);
  const categoryRef = useRef(category);
  const inputId = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  // Search params do not remount this component, so a URL change that did not come from typing
  // (back/forward, a clear link) has to reach the input here. Never while someone is typing.
  useEffect(() => {
    requested.current = text;
    const input = inputRef.current;
    if (input && document.activeElement !== input) input.value = text ?? "";
  }, [text]);

  useEffect(() => {
    categoryRef.current = category;
  }, [category]);

  function apply(value: string) {
    clearTimeout(timer.current);
    // The same cleaning as the page's, so "a  b" and "a b" are one filter and one URL.
    const next = cleanRecentText(value);
    if (next === requested.current) return;
    requested.current = next;
    const href = recentHref({ category: categoryRef.current, text: next });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  /** A category pill or the clear link navigates on its own; a pending keystroke must not undo it. */
  function cancelPending() {
    clearTimeout(timer.current);
  }

  function onCategory(e: MouseEvent<HTMLAnchorElement>, id: string | undefined) {
    // A new tab or window keeps the link's own URL, and this page its pending keystroke.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    cancelPending();
    categoryRef.current = id;
    const typed = cleanRecentText(inputRef.current?.value ?? "");
    requested.current = typed;
    if (typed === text) return; // the link already carries it
    // Text typed but not in the URL yet: keep it with the new category.
    e.preventDefault();
    const href = recentHref({ category: id, text: typed });
    startTransition(() => router.push(href, { scroll: false }));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    apply(inputRef.current?.value ?? "");
  }

  function onChange(value: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(value), DEBOUNCE_MS);
  }

  function onClear() {
    cancelPending();
    requested.current = undefined;
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <form action="/searches" role="search" onSubmit={onSubmit} className="max-w-xl space-y-2">
        <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
          חיפוש בחיפושים
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-52">
            {pending ? (
              <LoaderCircle
                aria-hidden
                className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted motion-safe:animate-spin"
              />
            ) : (
              <Search
                aria-hidden
                className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted"
              />
            )}
            <input
              ref={inputRef}
              id={inputId}
              name="q"
              type="search"
              defaultValue={text ?? ""}
              maxLength={RECENT_TEXT_MAX}
              placeholder="למשל: אוזניות"
              autoComplete="off"
              onChange={(e) => onChange(e.currentTarget.value)}
              className="h-12 w-full rounded-full border border-line bg-surface ps-12 pe-4 text-base text-ink placeholder:text-muted"
            />
          </div>
          {category && <input type="hidden" name="cat" value={category} />}
          <button type="submit" className={`${btnSecondary} ${btnMd}`}>
            סינון
          </button>
          {text && (
            <Link
              href={recentHref({ category })}
              scroll={false}
              onClick={onClear}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              <X aria-hidden className="size-4" />
              ניקוי הטקסט
            </Link>
          )}
        </div>
      </form>

      {categories.length > 0 && (
        // One scrollable row on phones (bleeding to the screen edges), wrapped from sm up.
        // The padding keeps the focus ring inside the scroll area; `relative` keeps the sr-only
        // counts (absolutely positioned) inside it too, or they would widen the page.
        <ul
          aria-label="סינון לפי קטגוריה"
          className="relative -mx-4 flex gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          {[{ id: undefined, labelHe: "הכול", count: null }, ...categories].map((c) => {
            const active = c.id === category;
            return (
              <li key={c.id ?? "all"} className="shrink-0">
                <Link
                  href={recentHref({ category: c.id, text })}
                  scroll={false}
                  onClick={(e) => onCategory(e, c.id)}
                  aria-current={active ? "page" : undefined}
                  className={`${PILL} whitespace-nowrap ${
                    active
                      ? "bg-ink text-bg"
                      : "border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink"
                  }`}
                >
                  {c.labelHe}
                  {c.count !== null && (
                    <span className={`font-normal ${active ? "" : "text-muted"}`}>
                      {c.count}
                      <span className="sr-only">{c.count === 1 ? " חיפוש" : " חיפושים"}</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
