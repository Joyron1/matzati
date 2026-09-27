// Background generation of category tips (LLM job c). Product pages never wait for it: they show
// what is stored and schedule this with after() when an entry is missing or stale. Views of the
// same category that arrive while a refresh runs join it instead of paying for a second call.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmProvider } from "@/lib/llm/provider";
import { generateCategoryTips } from "@/lib/llm/tips";
import type { LlmUsageRecord } from "@/lib/stats/usage";
import type { TipsCategory } from "./category";
import { readCategoryTips, writeCategoryTips } from "./store";

export interface TipsJobDeps {
  db: SupabaseClient;
  llm: LlmProvider;
  /** Counts one unit of today's LLM budget; false once the daily cap is used up. */
  chargeBudget: () => Promise<boolean>;
  /** Writes the call's llm_usage row (kind "tips"). A failure is logged, never fails the job. */
  recordUsage?: (record: LlmUsageRecord) => Promise<void>;
}

/** After a failed refresh (API error, budget used up, invalid output) this instance waits this long. */
export const RETRY_AFTER_FAILURE_MS = 30 * 60_000;

export interface TipsRefresherOptions {
  retryAfterMs?: number;
  clock?: () => number;
  log?: (message: string) => void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** Per server instance. Other instances are covered by the re-read before the paid call. */
export class TipsRefresher {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly failedAt = new Map<string, number>();
  private readonly retryAfterMs: number;
  private readonly clock: () => number;
  private readonly log: (message: string) => void;

  constructor(options: TipsRefresherOptions = {}) {
    this.retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_FAILURE_MS;
    this.clock = options.clock ?? Date.now;
    this.log = options.log ?? ((m) => console.error(`[tips] ${m.slice(0, 500)}`));
  }

  /**
   * Generates and stores tips for the category unless a fresh entry exists. Joins a refresh that
   * is already running for it. Never rejects: failures are logged and retried later.
   * `deps` is called inside the job, so a config error (a missing API key) is logged too.
   */
  refresh(category: TipsCategory, deps: () => TipsJobDeps): Promise<void> {
    const key = category.id;
    const running = this.inFlight.get(key);
    if (running) return running;
    const failed = this.failedAt.get(key);
    if (failed !== undefined && this.clock() - failed < this.retryAfterMs) return Promise.resolve();

    const run = this.run(category, deps)
      .then(
        (ok) => {
          if (ok) this.failedAt.delete(key);
          else this.failedAt.set(key, this.clock());
        },
        (err: unknown) => {
          this.failedAt.set(key, this.clock());
          this.log(`${key}: ${errorText(err)}`);
        },
      )
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  /** True when the category now has a current entry (possibly an empty one). */
  private async run(category: TipsCategory, makeDeps: () => TipsJobDeps): Promise<boolean> {
    const { db, llm, chargeBudget, recordUsage } = makeDeps();
    const now = new Date(this.clock());
    // Another instance (or an earlier view) may have written it since the page read it.
    const current = await readCategoryTips(category.id, now, db);
    if (current && !current.stale) return true;
    if (!(await chargeBudget())) {
      this.log(`${category.id}: daily LLM budget is used up`);
      return false;
    }
    const res = await generateCategoryTips(llm, {
      category: category.nameEn,
      parent_category: category.parentEn,
    });
    // Recorded first: the call is paid for whatever happens to its output.
    try {
      await recordUsage?.({ kind: "tips", model: res.model, usage: res.usage });
    } catch (err) {
      this.log(`${category.id}: usage not recorded: ${errorText(err)}`);
    }
    if (res.outcome === "invalid_output") {
      // At temperature 0 the same request would most likely fail the same way; retrying every
      // 30 minutes could cost dozens of calls a day for one category. Store an empty entry
      // instead, so it is retried only when the entry goes stale.
      this.log(`${category.id}: model output did not match the schema`);
    }
    if (res.outcome === "too_few") {
      const problems = res.rejected.map((r) => r.problem).join(", ");
      this.log(`${category.id}: too few tips passed the checks (${problems})`);
    }
    // Too few tips (or invalid output) is stored as an empty list: at temperature 0 a retry would most likely give
    // the same answer, so the category is not paid for again until the entry goes stale.
    await writeCategoryTips(
      category.id,
      { categoryEn: category.nameEn, tips: res.tips ?? [] },
      now,
      db,
    );
    return true;
  }
}
