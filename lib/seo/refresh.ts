// Refreshes of the SEO landing pages' stored results (./snapshot.ts). A refresh is a fresh search
// for the page's query through the site's own pipeline (no results cache, one retry after an
// upstream failure; refreshSearch in lib/search/server.ts), stored only when it is at least as
// good as what the page shows (decideSnapshot); otherwise the page keeps its snapshot and the
// reason is recorded for the admin. Callers: the admin's save and "רענון עכשיו" (app/admin/seo),
// the daily cron (app/api/cron/seo-refresh) and a page's first render while it has no snapshot.
// Everything it touches is injected (lib/seo/refresh-server.ts binds the real ones), so tests run
// with fakes; it never throws.
import type { SearchResponse } from "@/lib/types";
import {
  CRON_ATTEMPT_WINDOW_MS,
  decideSnapshot,
  pickStalePages,
  readSnapshot,
  resultsAtOf,
  type RefreshRow,
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
  response: SearchResponse;
  resultsAt: string;
  /** seo_pages.refresh_error after the write: null, or "degraded". */
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

export type RefreshOutcome =
  | {
      status: "stored";
      count: number;
      resultsAt: string;
      note: string | null;
      response: SearchResponse;
    }
  /**
   * The run worked but the snapshot stayed (see `note`), or the page still has none
   * (`hadSnapshot` false); its response for a first render.
   */
  | { status: "kept"; note: string; hadSnapshot: boolean; response: SearchResponse }
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
  /** Epoch ms by which the caller's function must be done (no retry would end after it). */
  deadline: number;
}

export interface RefresherDeps {
  store: () => SnapshotStore;
  /** A fresh search for the query: no results cache, one retry after an upstream failure. */
  search: (q: string, opts: { deadline: number }) => Promise<SnapshotRun>;
  /** The first live run of a page without a snapshot (examplePreview: cached results allowed). */
  preview: (q: string) => Promise<SnapshotRun>;
  /** True only on the live site: dev and preview deployments share its database. */
  writesAllowed: () => boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Name and message only. */
  logError?: (where: string, err: unknown) => void;
}

/** The daily cron's limits (app/api/cron/seo-refresh, maxDuration 60 s). */
export const CRON_LIMITS = {
  /** Pages refreshed per run at most (each is one search). */
  maxPages: 4,
  /** No page is started after this much of the run (a refresh takes 7-15 s, rarely 30+). */
  startCutoffMs: 25_000,
  /** The function's time limit less a margin: no retry is started that would end after it. */
  budgetMs: 55_000,
  /** Gap between two pages: AliExpress's frequency ban is shared by every call of the app key. */
  spacingMs: 2_000,
} as const;

/** A refresh from the admin (save or "רענון עכשיו") blocks another for this long. */
export const ADMIN_CLAIM_WINDOW_MS = 2 * 60_000;

export interface CronSummary {
  /** Pages due (pickStalePages). */
  due: number;
  /** Slugs whose snapshot was replaced: their pages are revalidated. */
  stored: string[];
  kept: number;
  failed: number;
  busy: number;
  /** Due pages left for the next night (per-run cap or time). */
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
  // the running one instead of starting another search (claim covers other instances).
  const inFlight = new Map<string, Promise<RefreshOutcome>>();

  /**
   * Decides and writes. A write that finds the page changed since it was read (a first visit
   * stored its run meanwhile, or the admin edited the query) is decided once more against what is
   * there now.
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
      if (!decision.store) {
        await store.recordNote(current.slug, current.query, decision.note);
        return { status: "kept", note: decision.note, hadSnapshot, response: run.response };
      }
      const resultsAt = resultsAtOf(run.response, now());
      const written = await store.store({
        slug: current.slug,
        query: current.query,
        response: run.response,
        resultsAt,
        note: decision.note,
        expectedResultsAt: current.resultsAt,
      });
      if (written) {
        return {
          status: "stored",
          count: run.response.results.length,
          resultsAt,
          note: decision.note,
          response: run.response,
        };
      }
      const again = await store.readState(current.slug);
      if (!again || again.query !== state.query) break;
      current = again;
    }
    return { status: "kept", note: "changed", hadSnapshot, response: run.response };
  }

  async function runRefresh(slug: string, opts: RefreshOptions): Promise<RefreshOutcome> {
    // Before anything else: no search is ever paid for where its result could not be stored.
    if (!deps.writesAllowed()) return { status: "disabled" };
    try {
      const store = deps.store();
      const state = await store.readState(slug);
      if (!state?.published) return { status: "missing" };
      if (!(await store.claim(slug, now(), opts.claimWindowMs))) return { status: "busy" };
      const run = await deps.search(state.query, { deadline: opts.deadline });
      return await settle(store, state, run);
    } catch (err) {
      logError("refresh", err);
      return { status: "failed", error: "unavailable" };
    }
  }

  /** Refreshes one page, or joins its refresh already running on this instance. */
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
   * runs the page's query once (examplePreview, as before snapshots) and stores the run when it
   * has results. `storedResultsAt` is results_at as the render read it (the write's condition).
   * Returns what the page shows; a failure is the caller's fallback.
   */
  async function firstRun(
    slug: string,
    query: string,
    storedResultsAt: string | null,
  ): Promise<SnapshotRun> {
    const running = inFlight.get(slug);
    if (running) {
      const out = await running;
      if (out.status === "stored") {
        return { ok: true, response: out.response, degraded: out.note !== null };
      }
      if (out.status === "kept") return { ok: true, response: out.response, degraded: false };
    }
    let run: SnapshotRun;
    try {
      run = await deps.preview(query);
    } catch (err) {
      logError("first-run", err);
      return { ok: false, error: "unavailable" };
    }
    if (!run.ok || !deps.writesAllowed()) return run;
    const decision = decideSnapshot(null, run);
    if (decision.store) {
      try {
        await deps.store().store({
          slug,
          query,
          response: run.response,
          resultsAt: resultsAtOf(run.response, now()),
          note: decision.note,
          expectedResultsAt: storedResultsAt,
        });
      } catch (err) {
        // The page still shows the run; the next render or refresh stores one.
        logError("first-run", err);
      }
    }
    return run;
  }

  /**
   * The daily cron: refreshes the pages that are due (pickStalePages), stalest first, one after
   * another with CRON_LIMITS.spacingMs between them, at most CRON_LIMITS.maxPages and none started
   * after CRON_LIMITS.startCutoffMs, so the run ends inside the function's time limit. Throws only
   * when the list of pages cannot be read.
   */
  async function refreshStale(clock: () => number = Date.now): Promise<CronSummary> {
    const started = clock();
    const due = pickStalePages(await deps.store().refreshRows(), now());
    const summary: CronSummary = {
      due: due.length,
      stored: [],
      kept: 0,
      failed: 0,
      busy: 0,
      notReached: 0,
    };
    let searched = 0;
    for (const [i, slug] of due.entries()) {
      if (searched >= CRON_LIMITS.maxPages || clock() - started > CRON_LIMITS.startCutoffMs) {
        summary.notReached = due.length - i;
        break;
      }
      if (searched > 0) await sleep(CRON_LIMITS.spacingMs);
      const out = await refresh(slug, {
        claimWindowMs: CRON_ATTEMPT_WINDOW_MS,
        deadline: started + CRON_LIMITS.budgetMs,
      });
      if (out.status === "stored") summary.stored.push(slug);
      else if (out.status === "kept") summary.kept++;
      else if (out.status === "failed") summary.failed++;
      else if (out.status === "busy") summary.busy++;
      if (out.status === "stored" || out.status === "kept" || out.status === "failed") searched++;
    }
    return summary;
  }

  return { refresh, firstRun, refreshStale };
}

export type SeoRefresher = ReturnType<typeof createSeoRefresher>;
