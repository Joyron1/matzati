import Form from "next/form";
import Link from "next/link";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { FocusScrollList } from "@/components/focus-scroll-list";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { hotCategories } from "@/lib/hot/categories";
import { DEFAULT_HOT_SORT, HOT_PATH, hotHref, isNarrowed, type HotFilter } from "@/lib/hot/params";
import { HOT_SORT_LABELS, HOT_SORTS, PRICE_BAND_IDS, PRICE_BANDS } from "@/lib/hot/select";
import { ClearFiltersLink } from "./clear-filters-link";

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
 * The category pills (links) and the price, sort and toggle filters: a plain GET form, so it works
 * without JavaScript; with it, next/form navigates without a full reload. The filters work on the
 * cached list, so only opening a category whose list is not cached costs an API call. A new
 * category or filter starts at page 1.
 *
 * On phones the form sits in a "סינון ומיון" disclosure, open while a filter or sort is on, so the
 * first products show on the first screen; from sm it is always open (.open-from-sm in
 * globals.css).
 */
export function HotFilters({ filter }: { filter: HotFilter }) {
  const { category } = filter;
  // No category: a mix of a few categories' lists (MIX_CATEGORY_IDS), so not "הכול".
  const pills = [{ id: undefined, labelHe: "מבחר" }, ...hotCategories()];
  // The fields are uncontrolled and keyed by the URL: a new URL (a pill, the clear link, back and
  // forward) remounts them, so they show its filter. The form and its button stay, so the button
  // keeps keyboard focus after a submit.
  const fieldsKey = hotHref({ ...filter, page: undefined });
  const active = isNarrowed(filter) || filter.sort !== DEFAULT_HOT_SORT;
  return (
    <div className="space-y-4">
      {/* One scrollable row on phones (bleeding to the screen edges), wrapped from sm up. The
          padding keeps the focus ring inside the scroll area; a pill that gets keyboard focus is
          scrolled fully into view, clear of the edge by the same room (scroll-px). */}
      <nav aria-label="קטגוריות">
        <FocusScrollList className="-mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:scroll-px-0 sm:px-0">
          {pills.map((c) => {
            const active = c.id === category;
            return (
              <li key={c.id ?? "all"} className="shrink-0">
                <Link
                  href={hotHref({ ...filter, category: c.id, page: undefined })}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`${PILL} whitespace-nowrap ${
                    active
                      ? "bg-ink text-bg"
                      : "border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink"
                  }`}
                >
                  {c.labelHe}
                </Link>
              </li>
            );
          })}
        </FocusScrollList>
      </nav>

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
          action={HOT_PATH}
          scroll={false}
          aria-label="סינון ומיון"
          className={`${card} flex flex-wrap items-end gap-x-6 gap-y-4 p-4 max-sm:mt-3 sm:p-5`}
        >
          {category && <input type="hidden" name="cat" value={category} />}
          {/* Side by side from 368px, where "₪100 עד ₪200" still fits its field. */}
          <div className="grid w-full grid-cols-1 gap-3 min-[23rem]:grid-cols-2 lg:w-auto lg:min-w-[26rem] lg:flex-1">
            <Select
              key={`price:${fieldsKey}`}
              label="מחיר"
              name="price"
              value={filter.price ?? ""}
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
              value={filter.sort === DEFAULT_HOT_SORT ? "" : filter.sort}
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
              checked={filter.withCode}
            />
            <Toggle
              key={`video:${fieldsKey}`}
              name="video"
              label="עם סרטון"
              checked={filter.withVideo}
            />
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="submit" className={`${btnPrimary} ${btnMd}`}>
              הצגת המוצרים
            </button>
            {isNarrowed(filter) && (
              <ClearFiltersLink href={hotHref({ category, sort: filter.sort })} />
            )}
          </div>
        </Form>
      </details>
    </div>
  );
}
