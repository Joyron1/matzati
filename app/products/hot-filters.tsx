import Form from "next/form";
import Link from "next/link";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { FocusScrollList } from "@/components/focus-scroll-list";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { DEFAULT_HOT_SORT, isNarrowed } from "@/lib/hot/params";
import {
  HOT_SORT_LABELS,
  HOT_SORTS,
  PRICE_BAND_IDS,
  PRICE_BANDS,
  type HotView,
} from "@/lib/hot/select";
import { ClearFiltersLink } from "./clear-filters-link";

/** A pill above the filters: a link to the same list narrowed another way (a sub-category). */
export interface FilterPill {
  key: string;
  href: string;
  label: string;
  current: boolean;
}

const PILL = "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold";
const SELECT =
  "h-12 w-full appearance-none truncate rounded-full border border-line bg-surface ps-4 pe-9 text-base text-ink hover:border-accent";

function Select({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="block text-sm font-semibold text-ink">{label}</span>
      <span className="relative block">
        <select name={name} defaultValue={value} className={SELECT}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
      </span>
    </label>
  );
}

function Toggle({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] font-medium text-ink">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
        className="size-5 shrink-0 accent-accent"
      />
      {label}
    </label>
  );
}

/**
 * The pills (links, when given) and the price, sort and toggle filters: a plain GET form to
 * `action`, so it works without JavaScript; with it, next/form navigates without a full reload.
 * The filters work on the lists already loaded, so no filter, sort or pill costs an API call. A
 * new pill or filter starts at the first step.
 *
 * On phones the form sits in a "סינון ומיון" disclosure, open while a filter or sort is on, so the
 * first products show on the first screen; from sm it is always open (.open-from-sm in
 * globals.css).
 */
export function HotFilters({
  view,
  action,
  hidden = {},
  fieldsKey,
  clearHref,
  pills = [],
  pillsLabel = "תת־קטגוריות",
}: {
  view: HotView;
  /** The page the form submits to. */
  action: string;
  /** Kept by a submit (the sub-category, the lists loaded). */
  hidden?: Record<string, string>;
  /**
   * The current URL without its step: the fields are uncontrolled and keyed by it, so a new URL (a
   * pill, the clear link, back and forward) remounts them and they show its filter. The form and
   * its button stay, so the button keeps keyboard focus after a submit.
   */
  fieldsKey: string;
  /** The same list without price, code and video (the sort kept). */
  clearHref: string;
  pills?: FilterPill[];
  pillsLabel?: string;
}) {
  const active = isNarrowed(view) || view.sort !== DEFAULT_HOT_SORT;
  return (
    <div className="space-y-4">
      {/* One scrollable row on phones (bleeding to the screen edges), wrapped from sm up. The
          padding keeps the focus ring inside the scroll area; a pill that gets keyboard focus is
          scrolled fully into view, clear of the edge by the same room (scroll-px). */}
      {pills.length > 0 && (
        <nav aria-label={pillsLabel}>
          <FocusScrollList className="-mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:scroll-px-0 sm:px-0">
            {pills.map((pill) => (
              <li key={pill.key} className="shrink-0">
                <Link
                  href={pill.href}
                  scroll={false}
                  aria-current={pill.current ? "page" : undefined}
                  className={`${PILL} whitespace-nowrap ${
                    pill.current
                      ? "bg-ink text-bg"
                      : "border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink"
                  }`}
                >
                  {pill.label}
                </Link>
              </li>
            ))}
          </FocusScrollList>
        </nav>
      )}

      <details open={active} className="open-from-sm group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-full border border-line bg-surface px-5 font-semibold text-ink hover:border-accent hover:text-accent-ink [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden className="size-[18px] shrink-0" />
            סינון ומיון
          </span>
          <ChevronDown
            aria-hidden
            className="size-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
          />
        </summary>
        <Form
          action={action}
          scroll={false}
          aria-label="סינון ומיון"
          className={`${card} flex flex-wrap items-end gap-x-6 gap-y-4 p-4 max-sm:mt-3 sm:p-5`}
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {/* Side by side from 368px, where "₪100 עד ₪200" still fits its field. */}
          <div className="grid w-full grid-cols-1 gap-3 min-[23rem]:grid-cols-2 lg:w-auto lg:min-w-[26rem] lg:flex-1">
            <Select
              key={`price:${fieldsKey}`}
              label="מחיר"
              name="price"
              value={view.price ?? ""}
              options={[
                { value: "", label: "כל המחירים" },
                ...PRICE_BAND_IDS.map((id) => ({ value: id, label: PRICE_BANDS[id].label })),
              ]}
            />
            <Select
              key={`sort:${fieldsKey}`}
              label="מיון"
              name="sort"
              // The default sort is sent empty, so it stays out of the URL.
              value={view.sort === DEFAULT_HOT_SORT ? "" : view.sort}
              options={HOT_SORTS.map((s) => ({
                value: s === DEFAULT_HOT_SORT ? "" : s,
                label: HOT_SORT_LABELS[s],
              }))}
            />
          </div>
          <fieldset className="flex flex-wrap gap-x-6">
            <legend className="sr-only">רק מוצרים</legend>
            <Toggle
              key={`code:${fieldsKey}`}
              name="code"
              label="עם קוד הנחה"
              checked={view.withCode}
            />
            <Toggle
              key={`video:${fieldsKey}`}
              name="video"
              label="עם סרטון"
              checked={view.withVideo}
            />
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="submit" className={`${btnPrimary} ${btnMd}`}>
              הצגת המוצרים
            </button>
            {isNarrowed(view) && <ClearFiltersLink href={clearHref} />}
          </div>
        </Form>
      </details>
    </div>
  );
}
