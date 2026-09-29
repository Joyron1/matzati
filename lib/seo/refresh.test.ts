// The SEO page refresher (lib/seo/refresh.ts) with an in-memory seo_pages and fake runs: nothing
// here reaches Supabase, AliExpress or an LLM.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "@/lib/types";
import {
  ADMIN_CLAIM_WINDOW_MS,
  createSeoRefresher,
  CRON_LIMITS,
  CRON_RUNS_PER_NIGHT,
  type PreviewRun,
  type RefresherDeps,
  type RefreshState,
  type SnapshotStore,
  type SnapshotWrite,
} from "./refresh";
import { fixtureProduct, fixtureResults, FIXTURE_QUERY } from "./results-fixture";
import { shownCount, type GroupState, type SeoResults } from "./results";
import type { RefreshRow, SnapshotRun } from "./snapshot";

const NOW = new Date("2026-09-29T01:00:00.000Z");
const Q = FIXTURE_QUERY;

const results = (count: number, states: GroupState[] = [], over = {}) =>
  fixtureResults(count, { states, fetchedAt: NOW.toISOString(), ...over });

const ok = (count: number, states: GroupState[] = []): SnapshotRun => ({
  ok: true,
  results: results(count, states),
});

function previewResponse(count: number): SearchResponse {
  return {
    query: Q,
    chips: [],
    sort: "best_value",
    checked_count: 100,
    passed_count: count,
    results: Array.from({ length: count }, (_, i) => fixtureProduct(i + 1)),
    more_available: false,
    fetched_at: NOW.toISOString(),
  };
}

const preview = (count: number, degraded = false): PreviewRun => ({
  ok: true,
  response: previewResponse(count),
  degraded,
});

/** Stored results as a refresh left them a week ago. */
const OLD_AT = "2026-09-20T01:00:00.000Z";
const stored = (count: number, states: GroupState[] = [], next?: SeoResults) => ({
  results: {
    ...fixtureResults(count, { states, fetchedAt: OLD_AT }),
    ...(next ? { next } : {}),
  },
  resultsAt: OLD_AT,
});

interface Page extends RefreshState {
  attemptedAt: string | null;
  note: string | null;
}

/** seo_pages in memory, with the same conditions as supabaseSnapshotStore's writes. */
class MemoryPages implements SnapshotStore {
  pages = new Map<string, Page>();
  writes: SnapshotWrite[] = [];
  /** Runs right before a store() is applied: a concurrent writer, for race tests. */
  beforeStore?: () => void;

  add(slug: string, over: Partial<Page> = {}) {
    this.pages.set(slug, {
      slug,
      query: Q,
      published: true,
      results: null,
      resultsAt: null,
      attemptedAt: null,
      note: null,
      ...over,
    });
  }
  async readState(slug: string) {
    const p = this.pages.get(slug);
    return p
      ? { slug, query: p.query, published: p.published, results: p.results, resultsAt: p.resultsAt }
      : null;
  }
  async claim(slug: string, at: Date, windowMs: number) {
    const p = this.pages.get(slug);
    if (!p?.published) return false;
    if (p.attemptedAt && Date.parse(p.attemptedAt) >= at.getTime() - windowMs) return false;
    p.attemptedAt = at.toISOString();
    return true;
  }
  async store(write: SnapshotWrite) {
    this.beforeStore?.();
    this.beforeStore = undefined;
    const p = this.pages.get(write.slug);
    if (!p || p.query !== write.query || p.resultsAt !== write.expectedResultsAt) return false;
    this.writes.push(write);
    Object.assign(p, { results: write.results, resultsAt: write.resultsAt, note: write.note });
    return true;
  }
  async recordNote(slug: string, query: string, note: string) {
    const p = this.pages.get(slug);
    if (p && p.query === query) p.note = note;
  }
  async refreshRows(): Promise<RefreshRow[]> {
    return [...this.pages.values()]
      .filter((p) => p.published)
      .map((p) => ({
        slug: p.slug,
        published: p.published,
        resultsAt: p.resultsAt,
        attemptedAt: p.attemptedAt,
        error: p.note,
      }));
  }
}

function setup(over: Partial<RefresherDeps> = {}) {
  const pages = new MemoryPages();
  const search = vi.fn<RefresherDeps["search"]>(async () => ok(50));
  const continueRun = vi.fn<RefresherDeps["continueRun"]>(async (r) => ({
    ok: true,
    results: { ...r, groups: r.groups.map((g) => ({ ...g, state: "model" as const })) },
  }));
  const previewRun = vi.fn<RefresherDeps["preview"]>(async () => preview(4));
  const sleep = vi.fn(async () => {});
  const refresher = createSeoRefresher({
    store: () => pages,
    search,
    continueRun,
    preview: previewRun,
    writesAllowed: () => true,
    now: () => NOW,
    sleep,
    logError: () => {},
    ...over,
  });
  return { pages, search, continueRun, preview: previewRun, sleep, refresher };
}

const ADMIN = { claimWindowMs: ADMIN_CLAIM_WINDOW_MS, deadline: NOW.getTime() + 55_000 };

const storedResults = (pages: MemoryPages, slug = "a") =>
  pages.pages.get(slug)?.results as (SeoResults & { next?: SeoResults }) | null;

describe("refresh", () => {
  it("stores a new collection for a page without a snapshot", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    const out = await refresher.refresh("a", ADMIN);
    expect(out).toMatchObject({ status: "stored", shown: 50, total: 50, pending: 0 });
    expect(search).toHaveBeenCalledWith(Q, { deadline: ADMIN.deadline, previous: [] });
    expect(pages.pages.get("a")).toMatchObject({
      resultsAt: NOW.toISOString(),
      attemptedAt: NOW.toISOString(),
      note: null,
    });
  });

  it("gives the run the stored results, so unchanged groups keep their lines", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a", stored(50));
    await refresher.refresh("a", ADMIN);
    const [, opts] = search.mock.calls[0];
    expect(opts.previous.map((r) => r.results.length)).toEqual([50]);
  });

  it("never overwrites a good snapshot with a failed, empty or smaller run", async () => {
    const { pages, search, refresher } = setup();
    const kept = stored(40);
    for (const [run, status, note] of [
      [{ ok: false, error: "upstream" }, "failed", "upstream"],
      [ok(0), "kept", "empty"],
      [ok(35), "kept", "smaller"],
    ] as const) {
      pages.add("a", kept);
      search.mockResolvedValueOnce(run);
      const out = await refresher.refresh("a", ADMIN);
      expect(out.status).toBe(status);
      expect(pages.pages.get("a")).toMatchObject({ ...kept, note });
    }
    expect(pages.writes).toHaveLength(0);
  });

  it("replaces it with at least as many products, and clears the last note", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a", { ...stored(40), note: "upstream" });
    search.mockResolvedValueOnce(ok(40));
    expect((await refresher.refresh("a", ADMIN)).status).toBe("stored");
    expect(pages.pages.get("a")).toMatchObject({ resultsAt: NOW.toISOString(), note: null });
  });

  it("stores a run that ran out of time at once when it shows at least as many", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a", stored(5, [], undefined));
    search.mockResolvedValueOnce(ok(50, ["model", "model", ...Array(8).fill("pending")]));
    const out = await refresher.refresh("a", ADMIN);
    expect(out).toMatchObject({ status: "stored", shown: 10, total: 50, pending: 8 });
    expect(pages.pages.get("a")?.note).toBe("incomplete");
  });

  it("keeps the shown results while a newer run that shows fewer waits beside them", async () => {
    const { pages, search, continueRun, refresher } = setup();
    pages.add("a", stored(50));
    search.mockResolvedValueOnce(ok(50, ["model", "pending"]));
    expect(await refresher.refresh("a", ADMIN)).toMatchObject({
      status: "preparing",
      shown: 5,
      total: 50,
    });
    const page = pages.pages.get("a")!;
    expect(page.resultsAt).toBe(OLD_AT);
    expect(page.note).toBe("incomplete");
    expect(shownCount(storedResults(pages)!)).toBe(50);
    expect(storedResults(pages)?.next?.groups[1].state).toBe("pending");

    // The next run writes its lines without searching, then shows it.
    page.attemptedAt = null;
    const out = await refresher.refresh("a", ADMIN);
    expect(continueRun).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "stored", shown: 50, pending: 0, note: null });
    expect(page.resultsAt).toBe(NOW.toISOString());
    expect(storedResults(pages)?.next).toBeUndefined();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("continues the shown results' pending groups without searching, keeping their date", async () => {
    const { pages, search, continueRun, refresher } = setup();
    pages.add("a", { ...stored(50, ["model", "model", "pending"]), note: "incomplete" });
    const out = await refresher.refresh("a", ADMIN);
    expect(search).not.toHaveBeenCalled();
    expect(continueRun).toHaveBeenCalledWith(expect.objectContaining({ fetched_at: OLD_AT }), {
      deadline: ADMIN.deadline,
    });
    expect(out).toMatchObject({ status: "stored", shown: 50, resultsAt: OLD_AT });
    expect(pages.pages.get("a")).toMatchObject({ resultsAt: OLD_AT, note: null });
  });

  it("drops a waiting run that turns out smaller and keeps the page as it was", async () => {
    const { pages, continueRun, refresher } = setup();
    const next = fixtureResults(30, { states: ["model", "pending"], fetchedAt: NOW.toISOString() });
    pages.add("a", stored(40, [], next));
    continueRun.mockResolvedValueOnce({
      ok: true,
      results: { ...next, groups: next.groups.map((g) => ({ ...g, state: "model" })) },
    });
    const out = await refresher.refresh("a", ADMIN);
    expect(out).toMatchObject({ status: "kept", note: "smaller" });
    expect(storedResults(pages)?.next).toBeUndefined();
    expect(storedResults(pages)?.results).toHaveLength(40);
    expect(pages.pages.get("a")?.resultsAt).toBe(OLD_AT);
  });

  it("treats a snapshot of the page's old query as none", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a", {
      results: fixtureResults(50, { query: "אוזניות", fetchedAt: OLD_AT }),
      resultsAt: OLD_AT,
    });
    search.mockResolvedValueOnce(ok(12));
    expect(await refresher.refresh("a", ADMIN)).toMatchObject({ status: "stored", total: 12 });
  });

  it("joins a refresh of the same page already running here", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    let release!: (run: SnapshotRun) => void;
    search.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = refresher.refresh("a", ADMIN);
    const second = refresher.refresh("a", ADMIN);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    release(ok(50));
    expect(await first).toBe(await second);
    expect(search).toHaveBeenCalledTimes(1);
    // Done: the next one runs again (and is refused by the claim window, not the map).
    expect((await refresher.refresh("a", ADMIN)).status).toBe("busy");
  });

  it("is busy while another instance's refresh holds the claim, and pays for nothing", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a", { attemptedAt: new Date(NOW.getTime() - 30_000).toISOString() });
    expect(await refresher.refresh("a", ADMIN)).toEqual({ status: "busy" });
    expect(search).not.toHaveBeenCalled();
  });

  it("does nothing for drafts, missing pages and outside production", async () => {
    const { pages, search, refresher } = setup();
    pages.add("draft", { published: false });
    expect(await refresher.refresh("draft", ADMIN)).toEqual({ status: "missing" });
    expect(await refresher.refresh("nope", ADMIN)).toEqual({ status: "missing" });
    const dev = setup({ writesAllowed: () => false });
    dev.pages.add("a");
    expect(await dev.refresher.refresh("a", ADMIN)).toEqual({ status: "disabled" });
    expect(search).not.toHaveBeenCalled();
    expect(dev.search).not.toHaveBeenCalled();
  });

  it("decides again when a first visit stored a run meanwhile", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    search.mockResolvedValueOnce(ok(3));
    pages.beforeStore = () => {
      const p = pages.pages.get("a")!;
      Object.assign(p, { results: results(4), resultsAt: "2026-09-29T00:59:00.000Z" });
    };
    // The page now has 4: a run of 3 must not replace it.
    expect(await refresher.refresh("a", ADMIN)).toMatchObject({ status: "kept", note: "smaller" });
    expect(pages.pages.get("a")?.resultsAt).toBe("2026-09-29T00:59:00.000Z");
  });

  it("stores nothing when the admin changed the query during the run", async () => {
    const { pages, refresher } = setup();
    pages.add("a");
    pages.beforeStore = () => {
      pages.pages.get("a")!.query = "סוללת גיבוי";
    };
    expect(await refresher.refresh("a", ADMIN)).toMatchObject({ status: "kept", note: "changed" });
    expect(pages.writes).toHaveLength(0);
  });

  it("answers failed when the database fails, never throws", async () => {
    const { refresher } = setup({
      store: () =>
        ({
          ...new MemoryPages(),
          readState: async () => {
            throw new Error("db down");
          },
        }) as unknown as SnapshotStore,
    });
    expect(await refresher.refresh("a", ADMIN)).toEqual({ status: "failed", error: "unavailable" });
  });
});

describe("firstRun (a page without a snapshot, at render time)", () => {
  it("runs the query once through examplePreview and stores its page, noted first_run", async () => {
    const { pages, preview: run, search, refresher } = setup();
    pages.add("a");
    const out = await refresher.firstRun("a", Q, null);
    expect(out).toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledWith(Q);
    expect(search).not.toHaveBeenCalled();
    expect(pages.pages.get("a")).toMatchObject({ resultsAt: NOW.toISOString(), note: "first_run" });
    expect(storedResults(pages)?.groups).toHaveLength(1);
  });

  it("stores nothing for a failed or empty run, and returns it for the page to show", async () => {
    const { pages, preview: run, refresher } = setup();
    pages.add("a");
    run.mockResolvedValueOnce({ ok: false, error: "upstream" });
    expect(await refresher.firstRun("a", Q, null)).toEqual({ ok: false, error: "upstream" });
    run.mockResolvedValueOnce(preview(0));
    expect(await refresher.firstRun("a", Q, null)).toMatchObject({ ok: true });
    expect(pages.writes).toHaveLength(0);
  });

  it("stores a degraded run as the data group, noted degraded", async () => {
    const { pages, preview: run, refresher } = setup();
    pages.add("a");
    run.mockResolvedValueOnce(preview(5, true));
    await refresher.firstRun("a", Q, null);
    expect(pages.pages.get("a")?.note).toBe("degraded");
    expect(storedResults(pages)?.groups[0].state).toBe("data");
  });

  it("shows but never stores outside production", async () => {
    const { pages, refresher } = setup({ writesAllowed: () => false });
    pages.add("a");
    expect(await refresher.firstRun("a", Q, null)).toMatchObject({ ok: true });
    expect(pages.writes).toHaveLength(0);
  });

  it("joins a refresh of the page running here instead of a second search", async () => {
    const { pages, search, preview: run, refresher } = setup();
    pages.add("a");
    let release!: (r: SnapshotRun) => void;
    search.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const refreshing = refresher.refresh("a", ADMIN);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const rendering = refresher.firstRun("a", Q, null);
    release(ok(50));
    await refreshing;
    expect(await rendering).toMatchObject({ ok: true, results: { results: expect.any(Array) } });
    expect(run).not.toHaveBeenCalled();
  });

  it("never throws: a store failure still shows the run", async () => {
    const { refresher } = setup({
      store: () => {
        throw new Error("no service key");
      },
    });
    expect(await refresher.firstRun("a", Q, null)).toMatchObject({ ok: true });
  });
});

describe("refreshStale (the cron)", () => {
  const DAY = 86_400_000;
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it("refreshes the due pages stalest first, spaced, at most maxPages", async () => {
    const { pages, search, sleep, refresher } = setup();
    for (const [slug, age] of [
      ["b", 8],
      ["a", 9],
      ["c", 20],
      ["d", 7.5],
      ["e", 10],
      ["fresh", 1],
    ] as const) {
      pages.add(slug, {
        results: fixtureResults(50, { fetchedAt: ago(age * DAY) }),
        resultsAt: ago(age * DAY),
      });
    }
    const summary = await refresher.refreshStale(() => 0);
    expect(summary).toMatchObject({ due: 5, kept: 0, failed: 0, busy: 0, notReached: 2 });
    expect(summary.stored).toEqual(["c", "e", "a"]);
    expect(search).toHaveBeenCalledTimes(CRON_LIMITS.maxPages);
    expect(sleep).toHaveBeenCalledTimes(CRON_LIMITS.maxPages - 1);
    expect(sleep).toHaveBeenCalledWith(CRON_LIMITS.spacingMs);
  });

  it("continues an incomplete page before refreshing stale ones", async () => {
    const { pages, search, continueRun, refresher } = setup();
    pages.add("stale", {
      results: fixtureResults(50, { fetchedAt: ago(20 * DAY) }),
      resultsAt: ago(20 * DAY),
    });
    pages.add("half", {
      ...stored(50, ["model", "pending"]),
      note: "incomplete",
      attemptedAt: ago(3_600_000),
    });
    const summary = await refresher.refreshStale(() => 0);
    expect(summary.stored).toEqual(["half", "stale"]);
    expect(continueRun).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("starts no page after the cutoff, so the function ends in time", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    pages.add("b");
    let t = 0;
    search.mockImplementation(async () => {
      t += CRON_LIMITS.startCutoffMs + 1;
      return ok(50);
    });
    const summary = await refresher.refreshStale(() => t);
    expect(summary).toMatchObject({ due: 2, notReached: 1 });
    expect(summary.stored).toEqual(["a"]);
  });

  it("gives every page the run's own deadline", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    await refresher.refreshStale(() => 1_000);
    expect(search.mock.calls[0][1].deadline).toBe(1_000 + CRON_LIMITS.budgetMs);
  });

  it("is safe to call twice: the second call finds nothing due", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    pages.add("b", {
      results: fixtureResults(50, { fetchedAt: ago(30 * DAY) }),
      resultsAt: ago(30 * DAY),
    });
    search.mockResolvedValueOnce({ ok: false, error: "upstream" });
    const first = await refresher.refreshStale(() => 0);
    expect(first).toMatchObject({ due: 2, failed: 1, stored: ["b"] });
    const second = await refresher.refreshStale(() => 0);
    expect(second).toMatchObject({ due: 0, stored: [], failed: 0 });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("covers the published pages weekly: vercel.json calls the route CRON_RUNS_PER_NIGHT times a night", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const runs = config.crons.filter((c) => c.path === "/api/cron/seo-refresh");
    expect(runs).toHaveLength(CRON_RUNS_PER_NIGHT);
    // Once a day each (Vercel Hobby), at different hours.
    expect(new Set(runs.map((c) => c.schedule)).size).toBe(runs.length);
    for (const c of runs) expect(c.schedule).toMatch(/^0 \d{1,2} \* \* \*$/);
    // About one new collection per run (25-45 s of the 55 s budget; seo-run.test.ts measures it).
    expect(CRON_RUNS_PER_NIGHT * 7).toBeGreaterThanOrEqual(10);
  });
});
