// Refreshes of the SEO landing pages' stored results (./snapshot.ts, ./results.ts). A refresh is
// either a new collection for the page's query (every product that passes, up to
// SEO_MAX_PRODUCTS, explained group by group; collectSeoResults in lib/search/seo-run.ts through
// lib/search/server.ts), stored only when it is at least as good as what the page shows
// (decideSnapshot), or, when a run left groups without lines, a continuation that writes them
// without fetching again. Otherwise the page keeps its snapshot and the reason is recorded for the
// admin. Callers: the admin's save and "רענון עכשיו" (app/admin/seo), the cron
// (app/api/cron/seo-refresh) and a page's first render while it has no snapshot. Everything it
// touches is injected (lib/seo/refresh-server.ts binds the real ones), so tests run with fakes; it
// never throws.
import { EXPLAIN_VERSION } from "@/lib/llm/explain";
import type { SearchResponse } from "@/lib/types";
import {
  fitForStorage,
  fromSearchResponse,
  groupsToExplain,
  shownCount,
  type SeoResults,
  type StoredSeoResults,
} from "./results";
import {
  continueTarget,
  CRON_ATTEMPT_WINDOW_MS,
  decideSnapshot,
  noteOf,
  pickStalePages,
  readSnapshot,
  REFRESH_NOTES,
  resultsAtOf,
  type RefreshRow,
  type SeoSnapshot,
  type SnapshotRun,
} from "./snapshot";

/** A page as a refresh reads it (service role): results_at exactly as stored, for the write. */
export interface RefreshState {
  slug: string;
  query: string;
  published: boolean;
  results: unknown;
  /** seo_pages.results_at as the database returned it (compare-and-set value), or null. */
  resultsAt: string | null;
}

export interface SnapshotWrite {
  slug: string;
  /** The query the run was made for: the write applies only while the page still has it. */
  query: string;
  results: StoredSeoResults;
  resultsAt: string;
  /** seo_pages.refresh_error after the write. */
  note: string | null;
  /** The results_at the decision was made against: the write applies only while it is unchanged. */
  expectedResultsAt: string | null;
}

/** The seo_pages reads and writes of a refresh (supabaseSnapshotStore in ./db.ts). */
export interface SnapshotStore {
  readState(slug: string): Promise<RefreshState | null>;
  /**
   * Marks a refresh of a published page as started (refresh_attempted_at), unless one started
   * within `windowMs`: false then, and nothing is changed. Atomic, so two server instances never
   * refresh one page at the same time.
   */
  claim(slug: string, at: Date, windowMs: number): Promise<boolean>;
  /** Stores a snapshot; false when the page changed since it was read (nothing written). */
  store(write: SnapshotWrite): Promise<boolean>;
  /** Records why the last refresh stored nothing, while the page still has this query. */
  recordNote(slug: string, query: string, note: string): Promise<void>;
  /** Every published page, for the cron. */
  refreshRows(): Promise<RefreshRow[]>;
}

/** How many products a page shows and has, and how many groups still wait for lines. */
export interface ResultsCount {
  shown: number;
  total: number;
  /** Groups whose lines are not written yet. */
  pending: number;
}

const countOf = (r: SeoResults): ResultsCount => ({
  shown: shownCount(r),
  total: r.results.length,
  pending: groupsToExplain(r),
});

export type RefreshOutcome =
  | ({
      status: "stored";
      resultsAt: string;
      note: string | null;
      results: SeoResults;
    } & ResultsCount)
  /** A newer run waits beside the shown results until its lines are written (snapshot `next`). */
  | ({ status: "preparing" } & ResultsCount)
  /**
   * The run worked but the snapshot stayed (see `note`), or the page still has none
   * (`hadSnapshot` false); its results for a first render.
   */
  | { status: "kept"; note: string; hadSnapshot: boolean; results: SeoResults }
  | { status: "failed"; error: string }
  /** Another refresh of this page started moments ago (claim). */
  | { status: "busy" }
  /** No such page, or it is a draft. */
  | { status: "missing" }
  /** Not in production: snapshots are written by the live site only. */
  | { status: "disabled" };

export interface RefreshOptions {
  /** How long a started refresh of the page blocks another (claim). */
  claimWindowMs: number;
  /** Epoch ms by which the caller's function must be done (no call starts that would end after it). */
  deadline: number;
}

/** A visitor-style run (the first render of a page without a snapshot). */
export type PreviewRun =
  { ok: true; response: SearchResponse; degraded: boolean } | { ok: false; error: string };

export interface RefresherDeps {
  store: () => SnapshotStore;
  /**
   * A new collection for the query (no results cache, one retry after an upstream failure).
   * `previous`: the page's stored results, whose unchanged groups keep their lines.
   */
  search: (
    q: string,
    opts: { deadline: number; previous: readonly SeoResults[] },
  ) => Promise<SnapshotRun>;
  /** Writes the lines a stored run still lacks, without fetching. */
  continueRun: (results: SeoResults, opts: { deadline: number }) => Promise<SnapshotRun>;
  /** The first live run of a page without a snapshot (examplePreview: cached results allowed). */
  preview: (q: string) => Promise<PreviewRun>;
  /** True only on the live site: dev and preview deployments share its database. */
  writesAllowed: () => boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Name and message only. */
  logError?: (where: string, err: unknown) => void;
}

/**
 * The cron's limits (app/api/cron/seo-refresh, maxDuration 60 s). A page's new collection takes
 * about 25-45 s (up to 5 product.query calls and up to 10 explain calls, 3 at a time; measured
 * with fakes in lib/search/seo-run.test.ts), a continuation 5-25 s, so one run refreshes about
 * one page and starts a second only while more than half the time is left; vercel.json calls the
 * route CRON_RUNS_PER_NIGHT times a night, which covers about 14 pages a week (the 10 published
 * pages, with room for continuations).
 */
export const CRON_LIMITS = {
  /** Pages refreshed or continued per run at most. */
  maxPages: 3,
  /** No page is started after this much of the run: at least 30 s are left for it. */
  startCutoffMs: 25_000,
  /** The function's time limit less a margin: every call starts only with room before it. */
  budgetMs: 55_000,
  /** Gap between two pages: AliExpress's frequency ban is shared by every call of the app key. */
  spacingMs: 2_000,
} as const;

/**
 * Entries for /api/cron/seo-refresh in vercel.json (01:00 and 03:00 UTC). Vercel Hobby allows 2
 * cron jobs per project (the deploy fails with more), so more pages a week need the Pro plan.
 */
export const CRON_RUNS_PER_NIGHT = 2;

/** A refresh from the admin (save or "רענון עכשיו") blocks another for this long. */
export const ADMIN_CLAIM_WINDOW_MS = 2 * 60_000;
/** A continuation blocks another for this long: longer than one run can take. */
export const CONTINUE_CLAIM_WINDOW_MS = 2 * 60_000;

export interface CronSummary {
  /** Pages due (pickStalePages). */
  due: number;
  /** Slugs whose shown results changed: their pages are revalidated. */
  stored: string[];
  /** Pages whose newer run waits beside the shown results. */
  preparing: number;
  kept: number;
  failed: number;
  busy: number;
  /** Due pages left for the next run (per-run cap or time). */
  notReached: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultLogError(where: string, err: unknown) {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[seo-refresh] ${where}: ${text.slice(0, 300)}`);
}

export function createSeoRefresher(deps: RefresherDeps) {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const logError = deps.logError ?? defaultLogError;
  // Refreshes running on this server instance, by slug: a second request for the same page joins
  // the running one instead of starting another run (claim covers other instances).
  const inFlight = new Map<string, Promise<RefreshOutcome>>();

  /** Stores the page's results as `results` (and `next` beside them), fitted to the size limit. */
  function write(
    store: SnapshotStore,
    state: RefreshState,
    results: SeoResults,
    next: SeoResults | null,
    resultsAt: string,
    note: string | null,
  ): Promise<boolean> {
    return store.store({
      slug: state.slug,
      query: state.query,
      results: fitForStorage(next ? { ...results, next } : results),
      resultsAt,
      note,
      expectedResultsAt: state.resultsAt,
    });
  }

  function stored(results: SeoResults, resultsAt: string, note: string | null): RefreshOutcome {
    return { status: "stored", resultsAt, note, results, ...countOf(results) };
  }

  /**
   * Decides and writes a new collection. A write that finds the page changed since it was read (a
   * first visit stored its run meanwhile, or the admin edited the query) is decided once more
   * against what is there now.
   */
  async function settle(
    store: SnapshotStore,
    state: RefreshState,
    run: SnapshotRun,
  ): Promise<RefreshOutcome> {
    if (!run.ok) {
      await store.recordNote(state.slug, state.query, run.error);
      return { status: "failed", error: run.error };
    }
    let current = state;
    let hadSnapshot = false;
    for (let round = 0; round < 2; round++) {
      const snapshot = readSnapshot(current, current.query);
      hadSnapshot = snapshot !== null;
      const decision = decideSnapshot(snapshot, run);
      if (decision.action === "keep") {
        await store.recordNote(current.slug, current.query, decision.note);
        return { status: "kept", note: decision.note, hadSnapshot, results: run.results };
      }
      if (decision.action === "replace") {
        const resultsAt = resultsAtOf(decision.results, now());
        if (await write(store, current, decision.results, null, resultsAt, decision.note)) {
          return stored(decision.results, resultsAt, decision.note);
        }
      } else if (snapshot && current.resultsAt) {
        // The newer run waits beside the shown results, which keep their date.
        if (
          await write(
            store,
            current,
            snapshot.results,
            decision.results,
            current.resultsAt,
            decision.note,
          )
        ) {
          return { status: "preparing", ...countOf(decision.results) };
        }
      }
      const again = await store.readState(current.slug);
      if (!again || again.query !== state.query) break;
      current = again;
    }
    return { status: "kept", note: "changed", hadSnapshot, results: run.results };
  }

  /**
   * Writes a continuation: the shown results with more lines (they keep their date), or the run
   * waiting beside them, which replaces them once it is at least as good (decideSnapshot again) and
   * is dropped when it turns out smaller.
   */
  async function settleContinue(
    store: SnapshotStore,
    state: RefreshState,
    snapshot: SeoSnapshot,
    which: "next" | "shown",
    run: SnapshotRun,
  ): Promise<RefreshOutcome> {
    if (!run.ok) {
      await store.recordNote(state.slug, state.query, run.error);
      return { status: "failed", error: run.error };
    }
    const keptAt = state.resultsAt ?? snapshot.resultsAt;
    const changed: RefreshOutcome = {
      status: "kept",
      note: "changed",
      hadSnapshot: true,
      results: run.results,
    };
    if (which === "shown") {
      const note = snapshot.next ? REFRESH_NOTES.incomplete : noteOf(run.results);
      const ok = await write(store, state, run.results, snapshot.next, keptAt, note);
      return ok ? stored(run.results, snapshot.resultsAt, note) : changed;
    }
    const decision = decideSnapshot({ ...snapshot, next: null }, run);
    if (decision.action === "replace") {
      const resultsAt = resultsAtOf(decision.results, now());
      const ok = await write(store, state, decision.results, null, resultsAt, decision.note);
      return ok ? stored(decision.results, resultsAt, decision.note) : changed;
    }
    if (decision.action === "next") {
      const ok = await write(
        store,
        state,
        snapshot.results,
        decision.results,
        keptAt,
        decision.note,
      );
      return ok ? { status: "preparing", ...countOf(decision.results) } : changed;
    }
    // Smaller after all: the waiting run is dropped, the page keeps its results.
    const ok = await write(store, state, snapshot.results, null, keptAt, decision.note);
    return ok
      ? { status: "kept", note: decision.note, hadSnapshot: true, results: run.results }
      : changed;
  }

  async function runRefresh(slug: string, opts: RefreshOptions): Promise<RefreshOutcome> {
    // Before anything else: no run is ever paid for where its result could not be stored.
    if (!deps.writesAllowed()) return { status: "disabled" };
    try {
      const store = deps.store();
      const state = await store.readState(slug);
      if (!state?.published) return { status: "missing" };
      const snapshot = readSnapshot(state, state.query);
      const target = continueTarget(snapshot, now());
      const window = target
        ? Math.min(opts.claimWindowMs, CONTINUE_CLAIM_WINDOW_MS)
        : opts.claimWindowMs;
      if (!(await store.claim(slug, now(), window))) return { status: "busy" };
      if (snapshot && target) {
        const run = await deps.continueRun(target.results, { deadline: opts.deadline });
        return await settleContinue(store, state, snapshot, target.which, run);
      }
      const previous = snapshot
        ? [snapshot.results, ...(snapshot.next ? [snapshot.next] : [])]
        : [];
      const run = await deps.search(state.query, { deadline: opts.deadline, previous });
      return await settle(store, state, run);
    } catch (err) {
      logError("refresh", err);
      return { status: "failed", error: "unavailable" };
    }
  }

  /** Refreshes (or continues) one page, or joins its refresh already running on this instance. */
  function refresh(slug: string, opts: RefreshOptions): Promise<RefreshOutcome> {
    const running = inFlight.get(slug);
    if (running) return running;
    const run = runRefresh(slug, opts);
    inFlight.set(slug, run);
    void run.finally(() => {
      if (inFlight.get(slug) === run) inFlight.delete(slug);
    });
    return run;
  }

  /**
   * A page without a snapshot, at render time: joins a refresh of it running on this instance, or
   * runs the page's query once (examplePreview, as before snapshots: one page of five) and stores
   * the run when it has results, noted first_run so the next cron run collects every product.
   * `storedResultsAt` is results_at as the render read it (the write's condition). Returns what
   * the page shows; a failure is the caller's fallback.
   */
  async function firstRun(
    slug: string,
    query: string,
    storedResultsAt: string | null,
  ): Promise<SnapshotRun> {
    const running = inFlight.get(slug);
    if (running) {
      const out = await running;
      if (out.status === "stored" || out.status === "kept") {
        return { ok: true, results: out.results };
      }
    }
    let preview: PreviewRun;
    try {
      preview = await deps.preview(query);
    } catch (err) {
      logError("first-run", err);
      return { ok: false, error: "unavailable" };
    }
    if (!preview.ok) return preview;
    const run: SnapshotRun = {
      ok: true,
      results: fromSearchResponse(preview.response, {
        degraded: preview.degraded,
        explainVersion: EXPLAIN_VERSION,
      }),
    };
    if (!deps.writesAllowed()) return run;
    const decision = decideSnapshot(null, run);
    if (decision.action === "replace") {
      try {
        await deps.store().store({
          slug,
          query,
          results: decision.results,
          resultsAt: resultsAtOf(decision.results, now()),
          note: decision.note,
          expectedResultsAt: storedResultsAt,
        });
      } catch (err) {
        // The page still shows the run; the next render or refresh stores one.
        logError("first-run", err);
      }
      return { ok: true, results: decision.results };
    }
    return run;
  }

  /**
   * The cron: refreshes or continues the pages that are due (pickStalePages), continuations first,
   * then stalest first, one after another with CRON_LIMITS.spacingMs between them, at most
   * CRON_LIMITS.maxPages and none started after CRON_LIMITS.startCutoffMs; every call inside a
   * page starts only with room before the run's deadline, so the run ends inside the function's
   * time limit. Throws only when the list of pages cannot be read.
   */
  async function refreshStale(clock: () => number = Date.now): Promise<CronSummary> {
    const started = clock();
    const due = pickStalePages(await deps.store().refreshRows(), now());
    const summary: CronSummary = {
      due: due.length,
      stored: [],
      preparing: 0,
      kept: 0,
      failed: 0,
      busy: 0,
      notReached: 0,
    };
    let worked = 0;
    for (const [i, slug] of due.entries()) {
      if (worked >= CRON_LIMITS.maxPages || clock() - started > CRON_LIMITS.startCutoffMs) {
        summary.notReached = due.length - i;
        break;
      }
      if (worked > 0) await sleep(CRON_LIMITS.spacingMs);
      const out = await refresh(slug, {
        claimWindowMs: CRON_ATTEMPT_WINDOW_MS,
        deadline: started + CRON_LIMITS.budgetMs,
      });
      if (out.status === "stored") summary.stored.push(slug);
      else if (out.status === "preparing") summary.preparing++;
      else if (out.status === "kept") summary.kept++;
      else if (out.status === "failed") summary.failed++;
      else if (out.status === "busy") summary.busy++;
      if (["stored", "preparing", "kept", "failed"].includes(out.status)) worked++;
    }
    return summary;
  }

  return { refresh, firstRun, refreshStale };
}

export type SeoRefresher = ReturnType<typeof createSeoRefresher>;
