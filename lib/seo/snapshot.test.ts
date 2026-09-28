import { describe, expect, it } from "vitest";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import type { ResultProduct, SearchResponse } from "@/lib/types";
import {
  CRON_ATTEMPT_WINDOW_MS,
  decideSnapshot,
  pickStalePages,
  readSnapshot,
  refreshNoteText,
  resultsAtOf,
  shouldRefreshAfterSave,
  STALE_AFTER_MS,
  type RefreshRow,
  type SeoSnapshot,
} from "./snapshot";

const IMAGE = "https://ae01.alicdn.aliexpress-media.com/kf/a.jpg";

function product(i: number): ResultProduct {
  return {
    product_id: `100500${i}`,
    title_he: `אוזניות ${i}`,
    title_en: `Earbuds ${i}`,
    why_he: "96% משוב חיובי ו־1,200 נמכרו ב־30 הימים האחרונים.",
    price_ils: 50 + i,
    original_price_ils: null,
    price_is_approx: false,
    discount_pct: null,
    positive_feedback_pct: 96,
    units_sold: 1200,
    passed_tier: "standard",
    image_urls: [IMAGE],
    category_id: "44",
  };
}

function response(count: number, over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: "אוזניות אלחוטיות",
    chips: [{ id: "keywords", kind: "keywords", label_he: "אוזניות אלחוטיות", removable: false }],
    sort: "best_value",
    checked_count: 120,
    passed_count: 14,
    results: Array.from({ length: count }, (_, i) => product(i + 1)),
    more_available: true,
    filters_key: "f".repeat(64),
    cached: false,
    fetched_at: "2026-09-28T10:00:00.000Z",
    ...over,
  };
}

const snapshot = (count: number): SeoSnapshot => ({
  response: response(count),
  resultsAt: "2026-09-20T01:00:00.000Z",
});

describe("readSnapshot", () => {
  const stored = { results: response(5), resultsAt: "2026-09-28T10:00:00.123456+00:00" };

  it("reads a stored response back with its date", () => {
    const read = readSnapshot(stored, "אוזניות אלחוטיות");
    expect(read?.resultsAt).toBe("2026-09-28T10:00:00.123Z");
    expect(read?.response).toEqual(response(5));
  });

  it("is the page's only while it was made for the page's query", () => {
    expect(readSnapshot(stored, "  אוזניות   אלחוטיות ")).not.toBeNull();
    expect(readSnapshot(stored, "סוללת גיבוי")).toBeNull();
  });

  it("needs a date: a query edit clears results_at", () => {
    expect(readSnapshot({ ...stored, resultsAt: null }, "אוזניות אלחוטיות")).toBeNull();
    expect(readSnapshot({ ...stored, resultsAt: "not a date" }, "אוזניות אלחוטיות")).toBeNull();
  });

  it("never trusts the stored jsonb: bad shapes and empty results are no snapshot", () => {
    const q = "אוזניות אלחוטיות";
    expect(readSnapshot({ ...stored, results: null }, q)).toBeNull();
    expect(readSnapshot({ ...stored, results: "x" }, q)).toBeNull();
    expect(readSnapshot({ ...stored, results: response(0) }, q)).toBeNull();
    const badId = { ...response(1), results: [{ ...product(1), product_id: "../x" }] };
    expect(readSnapshot({ ...stored, results: badId }, q)).toBeNull();
    const badPrice = { ...response(1), results: [{ ...product(1), price_ils: "12" }] };
    expect(readSnapshot({ ...stored, results: badPrice }, q)).toBeNull();
  });

  it("drops image URLs off AliExpress's CDN and keys it does not know", () => {
    const tampered = {
      ...response(1),
      results: [{ ...product(1), image_urls: ["http://evil.example/a.jpg", IMAGE] }],
      extra: "dropped",
    };
    const read = readSnapshot({ ...stored, results: tampered }, "אוזניות אלחוטיות");
    expect(read?.response.results[0].image_urls).toEqual([IMAGE]);
    expect(read?.response).not.toHaveProperty("extra");
  });

  it("shows at most a page", () => {
    const read = readSnapshot(
      { ...stored, results: response(RESULTS_PER_PAGE + 2) },
      "אוזניות אלחוטיות",
    );
    expect(read?.response.results).toHaveLength(RESULTS_PER_PAGE);
  });
});

describe("resultsAtOf", () => {
  const now = new Date("2026-09-29T01:00:00Z");

  it("is when AliExpress was asked: the response's fetched_at", () => {
    expect(resultsAtOf(response(1), now)).toBe("2026-09-28T10:00:00.000Z");
  });

  it("falls back to now without one, or with one in the future", () => {
    expect(resultsAtOf(response(1, { fetched_at: undefined }), now)).toBe(now.toISOString());
    expect(resultsAtOf(response(1, { fetched_at: "2026-10-05T00:00:00Z" }), now)).toBe(
      now.toISOString(),
    );
  });
});

describe("decideSnapshot (owner decision 2026-09-29)", () => {
  const run = (count: number, degraded = false) => ({
    ok: true as const,
    response: response(count),
    degraded,
  });

  it("never stores a failed or empty run", () => {
    expect(decideSnapshot(snapshot(5), { ok: false, error: "upstream" })).toEqual({
      store: false,
      note: "upstream",
    });
    expect(decideSnapshot(null, { ok: false, error: "llm" })).toEqual({
      store: false,
      note: "llm",
    });
    expect(decideSnapshot(snapshot(3), run(0))).toEqual({ store: false, note: "empty" });
    expect(decideSnapshot(null, run(0))).toEqual({ store: false, note: "empty" });
  });

  it("replaces a snapshot only with at least as many results", () => {
    expect(decideSnapshot(snapshot(3), run(3))).toEqual({ store: true, note: null });
    expect(decideSnapshot(snapshot(3), run(5))).toEqual({ store: true, note: null });
    expect(decideSnapshot(snapshot(4), run(3))).toEqual({ store: false, note: "smaller" });
  });

  it("a full page always replaces", () => {
    const big: SeoSnapshot = { ...snapshot(0), response: response(RESULTS_PER_PAGE + 1) };
    expect(decideSnapshot(big, run(RESULTS_PER_PAGE))).toEqual({ store: true, note: null });
  });

  it("keeps a snapshot over a degraded run, but a page without one takes it", () => {
    expect(decideSnapshot(snapshot(2), run(5, true))).toEqual({ store: false, note: "degraded" });
    expect(decideSnapshot(null, run(2, true))).toEqual({ store: true, note: "degraded" });
    expect(decideSnapshot(null, run(1))).toEqual({ store: true, note: null });
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

  it("retries a degraded snapshot the next night", () => {
    expect(pickStalePages([row({ error: "degraded" })], now)).toEqual(["a"]);
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
  const page = { query: "אוזניות אלחוטיות", published: true };

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
      "unavailable",
      "something_new",
    ]) {
      expect(refreshNoteText(note, true)).toMatch(hebrew);
    }
    expect(refreshNoteText("empty", true)).toContain("נשארו התוצאות הקודמות");
    expect(refreshNoteText("empty", false)).not.toContain("נשארו");
  });
});
