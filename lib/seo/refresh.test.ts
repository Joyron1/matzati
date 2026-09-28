// The SEO page refresher (lib/seo/refresh.ts) with an in-memory seo_pages and fake searches:
// nothing here reaches Supabase, AliExpress or an LLM.
import { describe, expect, it, vi } from "vitest";
import type { ResultProduct, SearchResponse } from "@/lib/types";
import {
  ADMIN_CLAIM_WINDOW_MS,
  createSeoRefresher,
  CRON_LIMITS,
  type RefresherDeps,
  type RefreshState,
  type SnapshotStore,
  type SnapshotWrite,
} from "./refresh";
import type { RefreshRow, SnapshotRun } from "./snapshot";

const NOW = new Date("2026-09-29T01:00:00.000Z");
const Q = "אוזניות אלחוטיות";

function product(i: number): ResultProduct {
  return {
    product_id: `100500${i}`,
    title_he: `אוזניות ${i}`,
    title_en: `Earbuds ${i}`,
    why_he: "",
    price_ils: 50,
    original_price_ils: null,
    price_is_approx: false,
    discount_pct: null,
    positive_feedback_pct: 96,
    units_sold: 1200,
    passed_tier: "standard",
    image_urls: [],
    category_id: "44",
  };
}

function response(count: number, query = Q): SearchResponse {
  return {
    query,
    chips: [],
    sort: "best_value",
    checked_count: 100,
    passed_count: count,
    results: Array.from({ length: count }, (_, i) => product(i + 1)),
    more_available: false,
    fetched_at: NOW.toISOString(),
  };
}

const ok = (count: number, degraded = false): SnapshotRun => ({
  ok: true,
  response: response(count),
  degraded,
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
    Object.assign(p, { results: write.response, resultsAt: write.resultsAt, note: write.note });
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
  const search = vi.fn<RefresherDeps["search"]>(async () => ok(5));
  const preview = vi.fn<RefresherDeps["preview"]>(async () => ok(4));
  const sleep = vi.fn(async () => {});
  const refresher = createSeoRefresher({
    store: () => pages,
    search,
    preview,
    writesAllowed: () => true,
    now: () => NOW,
    sleep,
    logError: () => {},
    ...over,
  });
  return { pages, search, preview, sleep, refresher };
}

const ADMIN = { claimWindowMs: ADMIN_CLAIM_WINDOW_MS, deadline: NOW.getTime() + 55_000 };

describe("refresh", () => {
  it("stores a fresh run for a page without a snapshot", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    const out = await refresher.refresh("a", ADMIN);
    expect(out).toMatchObject({ status: "stored", count: 5, resultsAt: NOW.toISOString() });
    expect(search).toHaveBeenCalledWith(Q, { deadline: ADMIN.deadline });
    expect(pages.pages.get("a")).toMatchObject({
      resultsAt: NOW.toISOString(),
      attemptedAt: NOW.toISOString(),
      note: null,
    });
  });

  it("never overwrites a good snapshot with a failed, empty or smaller run", async () => {
    const { pages, search, refresher } = setup();
    const kept = { results: response(4), resultsAt: "2026-09-20T01:00:00.000Z" };
    for (const [run, status, note] of [
      [{ ok: false, error: "upstream" }, "failed", "upstream"],
      [ok(0), "kept", "empty"],
      [ok(3), "kept", "smaller"],
      [ok(5, true), "kept", "degraded"],
    ] as const) {
      pages.add("a", kept);
      search.mockResolvedValueOnce(run);
      const out = await refresher.refresh("a", ADMIN);
      expect(out.status).toBe(status);
      expect(pages.pages.get("a")).toMatchObject({ ...kept, note });
    }
    expect(pages.writes).toHaveLength(0);
  });

  it("replaces it with at least as many results, and clears the last note", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a", {
      results: response(4),
      resultsAt: "2026-09-20T01:00:00.000Z",
      note: "upstream",
    });
    search.mockResolvedValueOnce(ok(4));
    expect((await refresher.refresh("a", ADMIN)).status).toBe("stored");
    expect(pages.pages.get("a")).toMatchObject({ resultsAt: NOW.toISOString(), note: null });
  });

  it("treats a snapshot of the page's old query as none", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a", { results: response(5, "אוזניות"), resultsAt: "2026-09-20T01:00:00.000Z" });
    search.mockResolvedValueOnce(ok(2));
    expect(await refresher.refresh("a", ADMIN)).toMatchObject({ status: "stored", count: 2 });
  });

  it("joins a refresh of the same page already running here", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    let release!: (run: SnapshotRun) => void;
    search.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = refresher.refresh("a", ADMIN);
    const second = refresher.refresh("a", ADMIN);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    release(ok(5));
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
      Object.assign(p, { results: response(4), resultsAt: "2026-09-29T00:59:00.000Z" });
    };
    // The page now shows 4: a run of 3 must not replace it.
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
  it("runs the query once through examplePreview and stores it", async () => {
    const { pages, preview, search, refresher } = setup();
    pages.add("a");
    const run = await refresher.firstRun("a", Q, null);
    expect(run).toMatchObject({ ok: true });
    expect(preview).toHaveBeenCalledWith(Q);
    expect(search).not.toHaveBeenCalled();
    expect(pages.pages.get("a")).toMatchObject({ resultsAt: NOW.toISOString(), note: null });
  });

  it("stores nothing for a failed or empty run, and returns it for the page to show", async () => {
    const { pages, preview, refresher } = setup();
    pages.add("a");
    preview.mockResolvedValueOnce({ ok: false, error: "upstream" });
    expect(await refresher.firstRun("a", Q, null)).toEqual({ ok: false, error: "upstream" });
    preview.mockResolvedValueOnce(ok(0));
    expect(await refresher.firstRun("a", Q, null)).toMatchObject({ ok: true });
    expect(pages.writes).toHaveLength(0);
  });

  it("shows but never stores outside production", async () => {
    const { pages, refresher } = setup({ writesAllowed: () => false });
    pages.add("a");
    expect(await refresher.firstRun("a", Q, null)).toMatchObject({ ok: true });
    expect(pages.writes).toHaveLength(0);
  });

  it("joins a refresh of the page running here instead of a second search", async () => {
    const { pages, search, preview, refresher } = setup();
    pages.add("a");
    let release!: (run: SnapshotRun) => void;
    search.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const refreshing = refresher.refresh("a", ADMIN);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const rendering = refresher.firstRun("a", Q, null);
    release(ok(5));
    await refreshing;
    expect(await rendering).toMatchObject({ ok: true, response: { results: expect.any(Array) } });
    expect(preview).not.toHaveBeenCalled();
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

describe("refreshStale (the daily cron)", () => {
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
      pages.add(slug, { results: response(5), resultsAt: ago(age * DAY) });
    }
    const summary = await refresher.refreshStale(() => 0);
    expect(summary).toMatchObject({ due: 5, kept: 0, failed: 0, busy: 0, notReached: 1 });
    expect(summary.stored).toEqual(["c", "e", "a", "b"]);
    expect(search).toHaveBeenCalledTimes(CRON_LIMITS.maxPages);
    expect(sleep).toHaveBeenCalledTimes(CRON_LIMITS.maxPages - 1);
    expect(sleep).toHaveBeenCalledWith(CRON_LIMITS.spacingMs);
  });

  it("starts no page after the cutoff, so the function ends in time", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    pages.add("b");
    let t = 0;
    search.mockImplementation(async () => {
      t += CRON_LIMITS.startCutoffMs + 1;
      return ok(5);
    });
    const summary = await refresher.refreshStale(() => t);
    expect(summary).toMatchObject({ due: 2, notReached: 1 });
    expect(summary.stored).toEqual(["a"]);
  });

  it("is safe to call twice: the second call finds nothing due", async () => {
    const { pages, search, refresher } = setup();
    pages.add("a");
    pages.add("b", { results: response(5), resultsAt: ago(30 * DAY) });
    search.mockResolvedValueOnce({ ok: false, error: "upstream" });
    const first = await refresher.refreshStale(() => 0);
    expect(first).toMatchObject({ due: 2, failed: 1, stored: ["b"] });
    const second = await refresher.refreshStale(() => 0);
    expect(second).toMatchObject({ due: 0, stored: [], failed: 0 });
    expect(search).toHaveBeenCalledTimes(2);
  });
});
