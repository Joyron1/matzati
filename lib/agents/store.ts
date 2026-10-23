// The agents' tables (supabase/migrations/20261019120000_agents.sql) with the service role, and
// the candidates' life: queued by the finder, approved or rejected by the owner in /admin/agents,
// shown on /recommended once approved. Server-only.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { israelDayWindow } from "@/lib/guard/rate-limit";
import type { LlmUsage } from "@/lib/llm/provider";
import { SupabaseStore } from "@/lib/search/supabase-store";
import type { FinderStore, NewCandidate } from "./finder/run";

const CANDIDATES = "agent_candidates";
const RUNS = "agent_runs";

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`agents ${op} failed${error?.message ? `: ${error.message.slice(0, 200)}` : ""}`);
}

export class SupabaseFinderStore implements FinderStore {
  private readonly search: SupabaseStore;
  constructor(private readonly db: SupabaseClient) {
    this.search = new SupabaseStore(db);
  }

  async runCount(): Promise<number> {
    const { count, error } = await this.db
      .from(RUNS)
      .select("id", { count: "exact", head: true })
      .eq("agent", "finder")
      .neq("status", "skipped");
    if (error) fail("runCount", error);
    return count ?? 0;
  }

  async spentTodayUsd(now: Date): Promise<number> {
    const { data, error } = await this.db
      .from(RUNS)
      .select("cost_usd")
      .gte("started_at", israelDayWindow(now).start.toISOString());
    if (error) fail("spentToday", error);
    return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  }

  async knownProductIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const known = new Set<string>();
    // In chunks: a long "in" list makes a long URL.
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await this.db
        .from(CANDIDATES)
        .select("product_id")
        .in("product_id", ids.slice(i, i + 200));
      if (error) fail("known", error);
      for (const r of data ?? []) known.add(r.product_id as string);
    }
    return known;
  }

  async startRun(trigger: "cron" | "admin"): Promise<string> {
    const { data, error } = await this.db
      .from(RUNS)
      .insert({ agent: "finder", trigger })
      .select("id")
      .single();
    if (error || !data) fail("startRun", error);
    return data.id as string;
  }

  async finishRun(id: string, r: Parameters<FinderStore["finishRun"]>[1]): Promise<void> {
    const { error } = await this.db
      .from(RUNS)
      .update({
        status: r.status,
        finished_at: new Date().toISOString(),
        scanned: r.scanned,
        added: r.added,
        ali_calls: r.aliCalls,
        cost_usd: Math.round(r.costUsd * 1e6) / 1e6,
        note: r.note?.slice(0, 500) ?? null,
      })
      .eq("id", id);
    if (error) fail("finishRun", error);
  }

  async insertCandidates(runId: string, candidates: NewCandidate[]): Promise<number> {
    if (!candidates.length) return 0;
    const { data, error } = await this.db
      .from(CANDIDATES)
      .upsert(
        candidates.map((c) => ({
          product_id: c.productId,
          agent: "finder",
          commission_pct: c.commissionPct,
          product: c.product,
          post_he: c.postHe.slice(0, 1000),
          why_he: c.whyHe.slice(0, 300),
          run_id: runId,
        })),
        // A product proposed meanwhile (another run) keeps its row.
        { onConflict: "product_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) fail("insertCandidates", error);
    return data?.length ?? 0;
  }

  async saveProducts(products: AliProduct[], checkedAt: Date): Promise<void> {
    await this.search.saveProducts(products, {}, checkedAt, { keepTitledRows: true });
  }

  async logUsage(model: string, usage: LlmUsage): Promise<void> {
    await this.search.logUsage([{ kind: "agent_finder", model, usage }]);
  }
}

// --- Candidates for the admin and the site -----------------------------------------------------

export type CandidateStatus = "pending" | "approved" | "rejected";

const productSchema = z.custom<AliProduct>(
  (v) => typeof v === "object" && v !== null && typeof (v as AliProduct).productId === "string",
);

const candidateRow = z.object({
  id: z.string(),
  product_id: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  commission_pct: z.coerce.number(),
  product: productSchema,
  post_he: z.string(),
  why_he: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  telegram_posted_at: z.string().nullable(),
  telegram_message_id: z.string().nullable(),
  telegram_error: z.string().nullable(),
  facebook_posted_at: z.string().nullable().default(null),
  facebook_error: z.string().nullable().default(null),
  instagram_posted_at: z.string().nullable().default(null),
  instagram_error: z.string().nullable().default(null),
});
export type Candidate = z.infer<typeof candidateRow>;

const COLUMNS =
  "id, product_id, status, commission_pct, product, post_he, why_he, created_at, decided_at, telegram_posted_at, telegram_message_id, telegram_error, facebook_posted_at, facebook_error, instagram_posted_at, instagram_error";

/** Candidates in `status`, newest first (approved: by when they were approved). */
export async function listCandidates(
  db: SupabaseClient,
  status: CandidateStatus,
  limit = 50,
): Promise<Candidate[]> {
  const order = status === "pending" ? "created_at" : "decided_at";
  const { data, error } = await db
    .from(CANDIDATES)
    .select(COLUMNS)
    .eq("status", status)
    .order(order, { ascending: false })
    .limit(limit);
  if (error) fail("list", error);
  return (data ?? []).flatMap((row) => {
    const parsed = candidateRow.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function getCandidate(db: SupabaseClient, id: string): Promise<Candidate | null> {
  const { data, error } = await db.from(CANDIDATES).select(COLUMNS).eq("id", id).maybeSingle();
  if (error) fail("get", error);
  const parsed = candidateRow.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function decideCandidate(
  db: SupabaseClient,
  id: string,
  status: CandidateStatus,
  postHe?: string,
): Promise<void> {
  const { error } = await db
    .from(CANDIDATES)
    .update({
      status,
      decided_at: status === "pending" ? null : new Date().toISOString(),
      ...(postHe !== undefined ? { post_he: postHe } : {}),
    })
    .eq("id", id);
  if (error) fail("decide", error);
}

export async function recordTelegram(
  db: SupabaseClient,
  id: string,
  result: { ok: true; messageId: string } | { ok: false; error: string },
): Promise<void> {
  const { error } = await db
    .from(CANDIDATES)
    .update(
      result.ok
        ? {
            telegram_posted_at: new Date().toISOString(),
            telegram_message_id: result.messageId,
            telegram_error: null,
          }
        : { telegram_error: result.error.slice(0, 300) },
    )
    .eq("id", id);
  if (error) fail("telegram", error);
}

/** What Facebook or Instagram answered for an approved candidate. */
export async function recordMeta(
  db: SupabaseClient,
  id: string,
  channel: "facebook" | "instagram",
  result: { ok: true; id: string } | { ok: false; error: string },
): Promise<void> {
  const idColumn = channel === "facebook" ? "facebook_post_id" : "instagram_media_id";
  const { error } = await db
    .from(CANDIDATES)
    .update(
      result.ok
        ? {
            [idColumn]: result.id,
            [`${channel}_posted_at`]: new Date().toISOString(),
            [`${channel}_error`]: null,
          }
        : { [`${channel}_error`]: result.error.slice(0, 300) },
    )
    .eq("id", id);
  if (error) fail(channel, error);
}

export interface AgentRun {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  scanned: number;
  added: number;
  ali_calls: number;
  cost_usd: number;
  note: string | null;
}

export async function listRuns(db: SupabaseClient, limit = 10): Promise<AgentRun[]> {
  const { data, error } = await db
    .from(RUNS)
    .select(
      "id, trigger, status, started_at, finished_at, scanned, added, ali_calls, cost_usd, note",
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) fail("runs", error);
  return (data ?? []).map((r) => ({ ...r, cost_usd: Number(r.cost_usd) }) as AgentRun);
}
