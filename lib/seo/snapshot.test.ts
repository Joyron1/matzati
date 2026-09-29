import { describe, expect, it } from "vitest";
import { RESULTS_PER_PAGE, SEO_MAX_PRODUCTS } from "@/lib/config/site";
import type { SearchResponse } from "@/lib/types";
import { fixtureProduct, fixtureResults, FIXTURE_IMAGE, FIXTURE_QUERY } from "./results-fixture";
import { shownCount } from "./results";
import {
  continueTarget,
  CONTINUE_AFTER_MS,
  CRON_ATTEMPT_WINDOW_MS,
  decideSnapshot,
  NEXT_MAX_AGE_MS,
  noteOf,
  pickStalePages,
  readSnapshot,
  refreshNoteText,
  resultsAtOf,
  shouldRefreshAfterSave,
  STALE_AFTER_MS,
  type RefreshRow,
  type SeoSnapshot,
} from "./snapshot";

const Q = FIXTURE_QUERY;

/** A snapshot stored before groups: a SearchResponse. */
function response(count: number, over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: Q,
    chips: [{ id: "keywords", kind: "keywords", label_he: Q, removable: false }],
    sort: "best_value",
    checked_count: 120,
    passed_count: 14,
    results: Array.from({ length: count }, (_, i) => fixtureProduct(i + 1)),
    more_available: true,
    filters_key: "f".repeat(64),
    cached: false,
    fetched_at: "2026-09-28T10:00:00.000Z",
    ...over,
  };
}

const snapshot = (count: number, states: ("model" | "data" | "pending")[] = []): SeoSnapshot => ({
  results: fixtureResults(count, { states }),
  next: null,
  resultsAt: "2026-09-20T01:00:00.000Z",
});

const RAW_AT = "2026-09-28T10:00:00.123456+00:00";

describe("readSnapshot", () => {
  const stored = { results: fixtureResults(50), resultsAt: RAW_AT };

  it("reads stored groups back with their date", () => {
    const read = readSnapshot(stored, Q);
    expect(read?.resultsAt).toBe("2026-09-28T10:00:00.123Z");
    expect(read?.results).toEqual(fixtureResults(50));
    expect(read?.next).toBeNull();
  });

  it("reads a snapshot stored before groups as one group of at most a page", () => {
    const read = readSnapshot({ ...stored, results: response(RESULTS_PER_PAGE + 2) }, Q);
    expect(read?.results.results).toHaveLength(RESULTS_PER_PAGE);
    expect(read?.results.groups).toEqual([
      { ids: read!.results.results.map((p) => p.product_id), state: "model" },
    ]);
    // Its lines cannot be continued: another refresh collects the page again.
    expect(read?.results.context).toBeNull();
  });

  it("is the page's only while it was made for the page's query", () => {
    expect(readSnapshot(stored, "  אוזניות   אלחוטיות ")).not.toBeNull();
    expect(readSnapshot(stored, "סוללת גיבוי")).toBeNull();
  });

  it("needs a date: a query edit clears results_at", () => {
    expect(readSnapshot({ ...stored, resultsAt: null }, Q)).toBeNull();
    expect(readSnapshot({ ...stored, resultsAt: "not a date" }, Q)).toBeNull();
  });

  it("never trusts the stored jsonb: bad shapes, empty results and broken groups", () => {
    const base = fixtureResults(12);
    expect(readSnapshot({ ...stored, results: null }, Q)).toBeNull();
    expect(readSnapshot({ ...stored, results: "x" }, Q)).toBeNull();
    expect(readSnapshot({ ...stored, results: response(0) }, Q)).toBeNull();
    const badId = {
      ...base,
      results: [{ ...base.results[0], product_id: "../x" }, ...base.results.slice(1)],
    };
    expect(readSnapshot({ ...stored, results: badId }, Q)).toBeNull();
    const badPrice = {
      ...base,
      results: [{ ...base.results[0], price_ils: "12" }, ...base.results.slice(1)],
    };
    expect(readSnapshot({ ...stored, results: badPrice }, Q)).toBeNull();
    // Groups must cover the products exactly, in order, five to a group.
    const swapped = { ...base, groups: [base.groups[1], base.groups[0], base.groups[2]] };
    expect(readSnapshot({ ...stored, results: swapped }, Q)).toBeNull();
    const short = { ...base, groups: base.groups.slice(0, 2) };
    expect(readSnapshot({ ...stored, results: short }, Q)).toBeNull();
    const six = {
      ...base,
      groups: [{ ids: base.results.slice(0, 6).map((p) => p.product_id), state: "model" }],
    };
    expect(readSnapshot({ ...stored, results: six }, Q)).toBeNull();
    const tooMany = fixtureResults(SEO_MAX_PRODUCTS + 5);
    expect(readSnapshot({ ...stored, results: tooMany }, Q)).toBeNull();
  });

  it("drops image URLs off AliExpress's CDN and keys it does not know", () => {
    const base = fixtureResults(1);
    const tampered = {
      ...base,
      results: [{ ...base.results[0], image_urls: ["http://evil.example/a.jpg", FIXTURE_IMAGE] }],
      extra: "dropped",
    };
    const read = readSnapshot({ ...stored, results: tampered }, Q);
    expect(read?.results.results[0].image_urls).toEqual([FIXTURE_IMAGE]);
    expect(read?.results).not.toHaveProperty("extra");
  });

  it("reads the run waiting beside the results, and leaves out one that does not read back", () => {
    const next = fixtureResults(50, { states: ["model", "pending"], offset: 100 });
    expect(readSnapshot({ ...stored, results: { ...fixtureResults(10), next } }, Q)?.next).toEqual(
      next,
    );
    const broken = { ...fixtureResults(10), next: { ...next, groups: [] } };
    const read = readSnapshot({ ...stored, results: broken }, Q);
    expect(read?.results.results).toHaveLength(10);
    expect(read?.next).toBeNull();
    const other = { ...fixtureResults(10), next: { ...next, query: "סוללת גיבוי" } };
    expect(readSnapshot({ ...stored, results: other }, Q)?.next).toBeNull();
  });
});

describe("resultsAtOf", () => {
  const now = new Date("2026-09-29T01:00:00Z");

  it("is when AliExpress was asked: the run's fetched_at", () => {
    expect(resultsAtOf(fixtureResults(1), now)).toBe("2026-09-28T10:00:00.000Z");
  });

  it("falls back to now without a usable one, or with one in the future", () => {
    expect(resultsAtOf({ fetched_at: "x" }, now)).toBe(now.toISOString());
    expect(resultsAtOf({ fetched_at: new Date(0).toISOString() }, now)).toBe(now.toISOString());
    expect(resultsAtOf({ fetched_at: "2026-10-05T00:00:00Z" }, now)).toBe(now.toISOString());
  });
});

describe("decideSnapshot (owner decisions 2026-09-29)", () => {
  const run = (count: number, states: ("model" | "data" | "pending")[] = []) => ({
    ok: true as const,
    results: fixtureResults(count, { states }),
  });

  it("never stores a failed or empty run", () => {
    expect(decideSnapshot(snapshot(5), { ok: false, error: "upstream" })).toEqual({
      action: "keep",
      note: "upstream",
    });
    expect(decideSnapshot(null, { ok: false, error: "llm" })).toEqual({
      action: "keep",
      note: "llm",
    });
    expect(decideSnapshot(snapshot(3), run(0))).toEqual({ action: "keep", note: "empty" });
    expect(decideSnapshot(null, run(0))).toEqual({ action: "keep", note: "empty" });
  });

  it("never replaces with fewer products, unless the run has the most a page shows", () => {
    expect(decideSnapshot(snapshot(30), run(30))).toMatchObject({ action: "replace", note: null });
    expect(decideSnapshot(snapshot(30), run(42))).toMatchObject({ action: "replace" });
    expect(decideSnapshot(snapshot(30), run(29))).toEqual({ action: "keep", note: "smaller" });
    expect(decideSnapshot(snapshot(SEO_MAX_PRODUCTS), run(SEO_MAX_PRODUCTS))).toMatchObject({
      action: "replace",
    });
  });

  it("stores an incomplete run at once when it shows at least as many as the page does", () => {
    const d = decideSnapshot(snapshot(10), run(50, ["model", "model", "model", "pending"]));
    expect(d).toMatchObject({ action: "replace", note: "incomplete" });
  });

  it("keeps an incomplete run that shows fewer beside the results until it is explained", () => {
    const d = decideSnapshot(snapshot(50), run(50, ["model", "pending"]));
    expect(d).toMatchObject({ action: "next", note: "incomplete" });
    const none = decideSnapshot(snapshot(50), run(50, ["pending"]));
    expect(none.action).toBe("next");
  });

  it("gives a page without results the first group with the lines from the data", () => {
    const d = decideSnapshot(null, run(20, ["pending", "pending", "pending", "pending"]));
    expect(d.action).toBe("replace");
    if (d.action !== "replace") return;
    expect(d.note).toBe("degraded");
    expect(d.results.groups[0].state).toBe("data");
    expect(shownCount(d.results)).toBe(RESULTS_PER_PAGE);
    const lead = d.results.results[0];
    expect(lead.title_he).toBe(lead.title_en);
    expect(lead.why_he).toMatch(/משוב חיובי/);
  });

  it("notes a page stored from a first render, so the cron collects all its products", () => {
    expect(noteOf(fixtureResults(5, { full: false }))).toBe("first_run");
    expect(noteOf(fixtureResults(50))).toBeNull();
    expect(noteOf(fixtureResults(50, { states: ["model", "pending"] }))).toBe("incomplete");
    expect(noteOf(fixtureResults(50, { states: ["data", "pending"] }))).toBe("degraded");
  });
});

describe("continueTarget", () => {
  const now = new Date("2026-09-29T01:00:00Z");

  it("continues the run waiting beside the results first, then the shown results", () => {
    const next = fixtureResults(50, { states: ["model", "pending"], fetchedAt: now.toISOString() });
    const shown = snapshot(50, ["model", "pending"]);
    expect(continueTarget({ ...shown, next }, now)).toEqual({ results: next, which: "next" });
    expect(continueTarget(shown, now)).toEqual({ results: shown.results, which: "shown" });
    expect(continueTarget(snapshot(50), now)).toBeNull();
    expect(continueTarget(null, now)).toBeNull();
  });

  it("collects again once a waiting run is older than two days", () => {
    const old = new Date(now.getTime() - NEXT_MAX_AGE_MS - 1).toISOString();
    const next = fixtureResults(50, { states: ["model", "pending"], fetchedAt: old });
    expect(continueTarget({ ...snapshot(50), next }, now)).toBeNull();
  });
});

describe("pickStalePages", () => {
  const now = new Date("2026-09-29T01:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const DAY = 86_400_000;
  const row = (over: Partial<RefreshRow>): RefreshRow => ({
    slug: "a",
    published: true,
    resultsAt: ago(DAY),
    attemptedAt: ago(DAY),
    error: null,
    ...over,
  });

  it("picks pages without a snapshot and those about a week old, stalest first", () => {
    const rows = [
      row({ slug: "fresh", resultsAt: ago(3 * DAY) }),
      row({ slug: "week", resultsAt: ago(7 * DAY) }),
      row({ slug: "none", resultsAt: null, attemptedAt: null }),
      row({ slug: "month", resultsAt: ago(30 * DAY) }),
      row({ slug: "draft", resultsAt: null, published: false }),
    ];
    expect(pickStalePages(rows, now)).toEqual(["none", "month", "week"]);
  });

  it("counts a snapshot stale a few hours before 7 days, so the nightly run keeps the week", () => {
    expect(pickStalePages([row({ resultsAt: ago(STALE_AFTER_MS) })], now)).toEqual(["a"]);
    expect(pickStalePages([row({ resultsAt: ago(STALE_AFTER_MS - 60_000) })], now)).toEqual([]);
    expect(STALE_AFTER_MS).toBeLessThan(7 * DAY);
    expect(STALE_AFTER_MS).toBeGreaterThan(6.5 * DAY);
  });

  it("continues an incomplete or degraded page 30 minutes after its last try, before the rest", () => {
    const rows = [
      row({ slug: "stale", resultsAt: ago(30 * DAY) }),
      row({ slug: "half", error: "incomplete", attemptedAt: ago(CONTINUE_AFTER_MS) }),
      row({ slug: "data", error: "degraded", attemptedAt: ago(CONTINUE_AFTER_MS + 1) }),
      row({ slug: "soon", error: "incomplete", attemptedAt: ago(CONTINUE_AFTER_MS - 60_000) }),
    ];
    expect(pickStalePages(rows, now)).toEqual(["data", "half", "stale"]);
  });

  it("collects a page stored from a first render at the next run", () => {
    expect(pickStalePages([row({ error: "first_run", attemptedAt: null })], now)).toEqual(["a"]);
  });

  it("skips a page tried in the last 20 hours, so a second call does nothing", () => {
    const stale = { resultsAt: null };
    expect(pickStalePages([row({ ...stale, attemptedAt: ago(60_000) })], now)).toEqual([]);
    expect(
      pickStalePages([row({ ...stale, attemptedAt: ago(CRON_ATTEMPT_WINDOW_MS) })], now),
    ).toEqual(["a"]);
  });

  it("waits a week after a lasting note instead of paying every night", () => {
    const old = ago(10 * DAY);
    for (const error of ["smaller", "empty", "parse_failed"]) {
      expect(
        pickStalePages([row({ resultsAt: old, attemptedAt: ago(2 * DAY), error })], now),
      ).toEqual([]);
      expect(
        pickStalePages([row({ resultsAt: old, attemptedAt: ago(7 * DAY), error })], now),
      ).toEqual(["a"]);
    }
    // A passing failure is tried again the next night.
    expect(
      pickStalePages([row({ resultsAt: old, attemptedAt: ago(DAY), error: "upstream" })], now),
    ).toEqual(["a"]);
  });
});

describe("shouldRefreshAfterSave", () => {
  const page = { query: Q, published: true };

  it("refreshes a page published now or whose query changed", () => {
    expect(shouldRefreshAfterSave(null, page)).toBe(true);
    expect(shouldRefreshAfterSave({ ...page, published: false }, page)).toBe(true);
    expect(shouldRefreshAfterSave({ ...page, query: "אוזניות" }, page)).toBe(true);
  });

  it("leaves other saves and drafts alone", () => {
    expect(shouldRefreshAfterSave(page, page)).toBe(false);
    expect(shouldRefreshAfterSave(null, { ...page, published: false })).toBe(false);
    expect(shouldRefreshAfterSave(page, { ...page, query: "x", published: false })).toBe(false);
  });
});

describe("refreshNoteText", () => {
  it("says every note in Hebrew, and whether the previous results stayed", () => {
    const hebrew = /[א-ת]/;
    for (const note of [
      "upstream",
      "llm",
      "capacity",
      "parse_failed",
      "invalid_query",
      "empty",
      "smaller",
      "degraded",
      "incomplete",
      "first_run",
      "time",
      "unavailable",
      "something_new",
    ]) {
      expect(refreshNoteText(note, true)).toMatch(hebrew);
    }
    expect(refreshNoteText("empty", true)).toContain("נשארו התוצאות הקודמות");
    expect(refreshNoteText("empty", false)).not.toContain("נשארו");
  });
});
