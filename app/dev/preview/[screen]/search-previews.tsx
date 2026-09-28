// Development-only previews of the /search view (./page.tsx dispatches to them): the real
// components/search-view.tsx fed by the page's own server functions (app/search/results.tsx) from a
// made-up search in the stages the real one streams (lib/search/server.ts SearchStream). Nothing
// here reads the database, AliExpress or an LLM, and the results are inert: nothing links to
// /search.
//
// /dev/preview/search-loading   the wait, then the results. ?u, ?r, ?d: when the query is
//                               understood, the products ranked and the lines written (ms);
//                               ?case=data (the explain step failed), empty, fail, cached
// /dev/preview/search-results   the finished results at once
// /dev/preview/search-update    a sort change: its buttons move to another view of the same search
//                               (ranked in 0.3 s, complete at 2 s), or with ?slow=1 a new fetch
// ?n=<results per page> on each (RESULTS_PER_PAGE by default), ?sort=<sort>.
import type { ReactNode } from "react";
import {
  completeResults,
  rankedSignal,
  understoodSignal,
  type SearchViewProps,
} from "@/app/search/results";
import { PendingNavigation } from "@/components/pending-navigation";
import { SearchComposer } from "@/components/search-composer";
import { SearchView, type SearchViewData } from "@/components/search-view";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { parseSort, type LoggedResult } from "@/lib/search-url";
import type { LoggedSearchResponse, SearchStream, Staged } from "@/lib/search/server";
import type { FilterChip, SortPreference } from "@/lib/types";
import { PreviewViewSwitch } from "./preview-controls";

export const SEARCH_SCREENS = ["search-loading", "search-results", "search-update"] as const;
export type SearchScreen = (typeof SEARCH_SCREENS)[number];

export const isSearchScreen = (value: string): value is SearchScreen =>
  (SEARCH_SCREENS as readonly string[]).includes(value);

/** The made-up query, which the made-up results below match. */
const PREVIEW_QUERY = "מארגן מגירות מתכוונן עד 20 ש״ח";

const PREVIEW_CHIPS: FilterChip[] = [
  { id: "product", kind: "keywords", label_he: "מארגן מגירות", removable: false },
  { id: "req-adjustable", kind: "must_have", label_he: "מתכוונן", removable: true },
  { id: "max-price", kind: "max_price", label_he: "עד ₪20", removable: true },
];

/** Six made-up products: AliExpress's title and data line, and the Hebrew title and line. */
const PRODUCTS: {
  en: string;
  he: string;
  why: string;
  data: string;
  price: number;
  pct: number;
  sold: number;
}[] = [
  {
    en: "6/8/10/12-Pack Adjustable Drawer Organizers, Clear Expandable Dresser Organizers for Storing Socks",
    he: "מארגן מגירות מתכוונן, סט של 6 עד 12",
    why: "מארגן מגירות שקוף ומתרחב לגרביים ולבגדים, בסט של 6 עד 12 יחידות לבחירה (נתונים מומצאים).",
    data: "98% משוב חיובי ו־11,268 נמכרו ב־30 הימים האחרונים.",
    price: 11.23,
    pct: 98,
    sold: 11268,
  },
  {
    en: "Kitchen Drawer Organizer Rack, Multi-Purpose Storage Tray with Dividers",
    he: "מתקן מארגן למגירת מטבח עם מחיצות",
    why: "מתקן רב־שימושי למגירת המטבח עם מחיצות לסכו״ם ולכלים קטנים (נתונים מומצאים).",
    data: "98% משוב חיובי ו־3,050 נמכרו ב־30 הימים האחרונים.",
    price: 16.65,
    pct: 98,
    sold: 3050,
  },
  {
    en: "Adjustable Plastic Cutlery Drawer Organizer Divided Storage Tray",
    he: "מארגן סכו״ם מתכוונן למגירה",
    why: "מארגן סכו״ם מפלסטיק עם תאים, שאפשר לכוונן לרוחב המגירה (נתונים מומצאים).",
    data: "96.4% משוב חיובי ו־1,204 נמכרו ב־30 הימים האחרונים.",
    price: 16.93,
    pct: 96.4,
    sold: 1204,
  },
  {
    en: "Expandable Bamboo Drawer Divider Adjustable Organizer 2 Pack",
    he: "מחיצות במבוק מתכווננות למגירה, זוג",
    why: "זוג מחיצות מבמבוק שנפתחות לרוחב המגירה ומחזיקות את התכולה במקום (נתונים מומצאים).",
    data: "97.1% משוב חיובי ו־2,410 נמכרו ב־30 הימים האחרונים.",
    price: 18.4,
    pct: 97.1,
    sold: 2410,
  },
  {
    en: "Adjustable Underwear Drawer Organizer Foldable Storage Box 7 Grids",
    he: "קופסת אחסון מתקפלת למגירה, 7 תאים",
    why: "קופסה מתקפלת עם 7 תאים לגרביים ולבגדים קטנים, למגירות בגדלים שונים (נתונים מומצאים).",
    data: "95.8% משוב חיובי ו־5,622 נמכרו ב־30 הימים האחרונים.",
    price: 9.87,
    pct: 95.8,
    sold: 5622,
  },
  {
    en: "Adjustable Spice Drawer Organizer 4 Tier Insert",
    he: "מארגן תבלינים מתכוונן למגירה, 4 שכבות",
    why: "מדף תבלינים בארבע שכבות שנכנס למגירה ונפתח לפי רוחבה (נתונים מומצאים).",
    data: "97.5% משוב חיובי ו־860 נמכרו ב־30 הימים האחרונים.",
    price: 19.5,
    pct: 97.5,
    sold: 860,
  },
];

/** The first `n` products in the order of `sort`: as ranked, or with their lines written. */
function results(n: number, sort: SortPreference, written: boolean): LoggedResult[] {
  const all = PRODUCTS.map((p, i) => ({ p, i }));
  const ordered =
    sort === "cheapest"
      ? [...all].sort((a, b) => a.p.price - b.p.price)
      : sort === "most_popular"
        ? [...all].sort((a, b) => b.p.sold - a.p.sold)
        : all;
  return ordered.slice(0, n).map(({ p, i }) => ({
    product_id: `10000000000000${11 + i}`,
    title_he: written ? p.he : p.en,
    title_en: p.en,
    why_he: written ? p.why : p.data,
    price_ils: p.price,
    original_price_ils: null,
    price_is_approx: false,
    discount_pct: null,
    positive_feedback_pct: p.pct,
    units_sold: p.sold,
    passed_tier: "standard",
    image_urls: [],
    category_id: null,
    search_uid: "00000000-0000-4000-8000-000000000002",
  }));
}

function response(shown: LoggedResult[], sort: SortPreference, now: Date): LoggedSearchResponse {
  return {
    query: PREVIEW_QUERY,
    chips: PREVIEW_CHIPS,
    sort,
    checked_count: 150,
    passed_count: shown.length ? 12 : 0,
    results: shown,
    more_available: shown.length > 0,
    filters_key: `preview-${sort}-${shown.length}`,
    cached: false,
    fetched_at: now.toISOString(),
    ...(shown.length
      ? {}
      : { blockers: [{ chip_id: "req-adjustable", would_pass: 7, title_matches: 0 }] }),
  };
}

/** `value` after `ms` (at once for 0): a made-up stage of the search. */
const after = <T,>(ms: number, value: T): Promise<T> =>
  ms > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), ms)) : Promise.resolve(value);

const CASES = ["written", "data", "empty", "fail", "cached"] as const;
type PreviewCase = (typeof CASES)[number];

interface Stages {
  n: number;
  sort: SortPreference;
  kind: PreviewCase;
  /** Understood, ranked and complete, in ms. */
  u: number;
  r: number;
  d: number;
}

/**
 * The view of a made-up search, built exactly as app/search/page.tsx builds it, its results made
 * inert (they link to /search).
 */
function previewView(now: Date, { n, sort, kind, u, r, d }: Stages): SearchViewData {
  const props: SearchViewProps = { q: PREVIEW_QUERY, sort, without: [], retryHref: "#" };
  const count = kind === "empty" ? 0 : n;
  const failed = { ok: false as const, error: "upstream" as const };
  const stream: SearchStream = {
    understood: after(u, {
      ok: true as const,
      value: { query: PREVIEW_QUERY, chips: PREVIEW_CHIPS, sort, waitedMs: u },
    }),
    products:
      kind === "fail"
        ? after(r, failed)
        : after(r, {
            ok: true as const,
            value: {
              response: response(results(count, sort, kind === "cached"), sort, now),
              // A cached set shows at once; nothing is written for an empty one.
              pending: count > 0 && kind !== "cached",
            },
          }),
    final:
      kind === "fail"
        ? after(r, failed)
        : after(d, {
            ok: true as const,
            value: response(results(count, sort, kind !== "data"), sort, now),
          }),
  };
  const started: Promise<Staged<SearchStream>> = Promise.resolve({ ok: true, value: stream });
  return {
    understood: understoodSignal(started),
    ranked: rankedSignal(started),
    results: completeResults(started, props).then((node) => <div inert>{node}</div>),
  };
}

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A number search param within [min, max], else `fallback`. */
function numberParam(value: string | string[] | undefined, fallback: number, max: number) {
  const n = Number(first(value));
  return first(value) !== undefined && Number.isFinite(n) && n >= 0 && n <= max
    ? Math.round(n)
    : fallback;
}

/** The /search page's frame: its bar (inert here) and the view. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <div inert>
        <SearchComposer variant="bar" defaultValue={PREVIEW_QUERY} />
      </div>
      <PendingNavigation>{children}</PendingNavigation>
    </div>
  );
}

export function SearchPreview({
  screen,
  params,
  now,
  note,
}: {
  screen: SearchScreen;
  params: Params;
  now: Date;
  /** The page's "made-up data" note, with this text. */
  note: (text: string) => ReactNode;
}) {
  const n = Math.max(1, numberParam(params.n, RESULTS_PER_PAGE, PRODUCTS.length));
  const sort = parseSort(params.sort) ?? "best_value";
  const kind = CASES.find((c) => c === first(params.case)) ?? "written";

  if (screen === "search-update") {
    const opening = sort === "best_value" && params.slow === undefined;
    const slow = first(params.slow) === "1";
    const view = previewView(now, {
      n,
      sort,
      kind,
      u: opening ? 0 : 150,
      r: opening ? 0 : slow ? 3_000 : 300,
      d: opening ? 0 : slow ? 6_000 : 2_000,
    });
    const href = (next: Record<string, string>) =>
      `/dev/preview/search-update?${new URLSearchParams({ n: String(n), ...next })}`;
    return (
      <>
        {note(
          "מעבר בין סידורים של אותו חיפוש: התוצאות נשארות מעומעמות עד שהתצוגה הבאה מוכנה. ״חיפוש חדש״ מדמה תצוגה שנשלפת מחדש מאלי אקספרס.",
        )}
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
          <PreviewViewSwitch
            views={[
              { label: "מחיר נמוך", href: href({ sort: "cheapest" }) },
              { label: "הכי נמכרים", href: href({ sort: "most_popular" }) },
              { label: "מחיר ואיכות, חיפוש חדש", href: href({ sort: "best_value", slow: "1" }) },
            ]}
          />
        </div>
        <Frame>
          <SearchView key="preview" query={PREVIEW_QUERY} view={view} slots={n} />
        </Frame>
      </>
    );
  }

  const instant = screen === "search-results";
  const view = previewView(now, {
    n,
    sort,
    kind,
    u: instant ? 0 : numberParam(params.u, 1_800, 60_000),
    r: instant ? 0 : numberParam(params.r, 6_000, 60_000),
    d: instant ? 0 : numberParam(params.d, 10_000, 60_000),
  });
  return (
    <>
      {note(
        instant
          ? "תוצאות חיפוש לדוגמה, כשהן מוכנות."
          : "מסך ההמתנה לתוצאות חיפוש, עם חיפוש לדוגמה: השלבים מתקדמים לפי שלבים מדומים של החיפוש, ואז התוצאות מופיעות. רעננו את הדף כדי להתחיל מחדש.",
      )}
      <Frame>
        <SearchView key="preview" query={PREVIEW_QUERY} view={view} slots={n} />
      </Frame>
    </>
  );
}
