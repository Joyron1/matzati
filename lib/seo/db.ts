// Queries against `seo_pages`, taking the Supabase client as a parameter so tests can pass a fake.
// lib/seo/queries.ts binds them to the real clients: the anon key for public reads (RLS only lets
// anon see published rows) and the service role for admin writes and the stored results
// (./snapshot.ts, ./refresh.ts). Published is checked again in code on public reads.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StoredSeoResults } from "./results";
import type { RefreshState, SnapshotStore, SnapshotWrite } from "./refresh";
import type { RefreshRow } from "./snapshot";
import { isValidSlug } from "./slug";

export type SeoClient = Pick<SupabaseClient, "from">;

export const SEO_TABLE = "seo_pages";
export const SEO_COLUMNS = "slug, query, title_he, intro_he, published, created_at, updated_at";
/** The sitemap and the admin list are not paged; far more pages than we will write. */
export const LIST_LIMIT = 1000;

export interface SeoPage {
  slug: string;
  /** The search that fills the page, as a visitor would type it. */
  query: string;
  title_he: string;
  intro_he: string | null;
  /** Only published pages are public (RLS: anon may select published = true). */
  published: boolean;
  created_at: string;
  updated_at: string;
}

/** What an admin edits; created_at and updated_at are kept by the database. */
export type SeoPageInput = Pick<SeoPage, "slug" | "query" | "title_he" | "intro_he" | "published">;

/** The database failed. The message comes from PostgREST and holds no secrets. */
export class SeoDbError extends Error {
  constructor(
    message: string,
    /** The Postgres or PostgREST error code, when there is one. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "SeoDbError";
  }
}

// A column the query names does not exist: Postgres for a read, PostgREST's schema cache for a
// write. Before 20260929010000_seo_snapshots.sql is applied, the snapshot columns are missing.
const MISSING_COLUMN_CODES: ReadonlySet<string> = new Set(["42703", "PGRST204"]);

/** True when the snapshot columns do not exist yet (the migration is not applied). */
export function isMissingColumnError(err: unknown): boolean {
  return err instanceof SeoDbError && err.code !== undefined && MISSING_COLUMN_CODES.has(err.code);
}

export class SeoPageNotFoundError extends Error {
  constructor(slug: string) {
    super(`seo page ${slug} not found`);
    this.name = "SeoPageNotFoundError";
  }
}

/** Another page already uses this slug (primary key violation). */
export class SeoSlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`slug ${slug} is taken`);
    this.name = "SeoSlugTakenError";
  }
}

const timestamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

const seoRowSchema = z.object({
  slug: z.string().refine(isValidSlug),
  query: z.string().min(1),
  title_he: z.string().min(1),
  intro_he: z
    .string()
    .nullable()
    .transform((s) => (s?.trim() ? s : null)),
  published: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});

/** A row as a SeoPage, or null when it does not have the expected shape (skipped, not a crash). */
export function toSeoPage(row: unknown): SeoPage | null {
  const parsed = seoRowSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

function toSeoPages(data: unknown): SeoPage[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const page = toSeoPage(row);
    return page ? [page] : [];
  });
}

type DbError = { message: string; code?: string };
type DbResult = { data: unknown; error: DbError | null };

const UNIQUE_VIOLATION = "23505";

async function run(query: PromiseLike<DbResult>, slug?: string): Promise<unknown> {
  const { data, error } = await query;
  if (error) {
    if (slug !== undefined && error.code === UNIQUE_VIOLATION) throw new SeoSlugTakenError(slug);
    throw new SeoDbError(error.message, error.code);
  }
  return data;
}

// Public reads (anon client).

/** The published page for this slug, or null. Invalid slugs never reach the database. */
export async function selectPublishedSeoPage(db: SeoClient, slug: string): Promise<SeoPage | null> {
  if (!isValidSlug(slug)) return null;
  const data = await run(
    db.from(SEO_TABLE).select(SEO_COLUMNS).eq("slug", slug).eq("published", true).maybeSingle(),
  );
  const page = data ? toSeoPage(data) : null;
  return page?.published && page.slug === slug ? page : null;
}

/** Published pages, newest first. */
export async function selectPublishedSeoPages(
  db: SeoClient,
  limit: number = LIST_LIMIT,
): Promise<SeoPage[]> {
  const data = await run(
    db
      .from(SEO_TABLE)
      .select(SEO_COLUMNS)
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return toSeoPages(data).filter((p) => p.published);
}

// Admin (service role; callers have passed requireAdmin()).

export async function selectAllSeoPages(db: SeoClient): Promise<SeoPage[]> {
  const data = await run(
    db
      .from(SEO_TABLE)
      .select(SEO_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(LIST_LIMIT),
  );
  return toSeoPages(data);
}

export async function selectSeoPage(db: SeoClient, slug: string): Promise<SeoPage | null> {
  if (!isValidSlug(slug)) return null;
  const data = await run(db.from(SEO_TABLE).select(SEO_COLUMNS).eq("slug", slug).maybeSingle());
  return data ? toSeoPage(data) : null;
}

function savedPage(data: unknown, slug: string): SeoPage {
  const page = data ? toSeoPage(data) : null;
  if (page) return page;
  throw new SeoPageNotFoundError(slug);
}

/** `input` must already be validated (validateSeoInput). Throws SeoSlugTakenError on a clash. */
export async function insertSeoPage(db: SeoClient, input: SeoPageInput): Promise<SeoPage> {
  const data = await run(db.from(SEO_TABLE).insert(input).select(SEO_COLUMNS).single(), input.slug);
  return savedPage(data, input.slug);
}

/**
 * Updates the page stored under `slug`; `input.slug` may rename it. `input` must already be
 * validated. Throws SeoPageNotFoundError when there is no such page and SeoSlugTakenError when
 * the new slug belongs to another page.
 */
export async function updateSeoPage(
  db: SeoClient,
  slug: string,
  input: SeoPageInput,
): Promise<SeoPage> {
  if (!isValidSlug(slug)) throw new SeoPageNotFoundError(String(slug));
  const data = await run(
    db.from(SEO_TABLE).update(input).eq("slug", slug).select(SEO_COLUMNS).maybeSingle(),
    input.slug,
  );
  return savedPage(data, slug);
}

/** Deleting a page that is already gone is not an error. */
export async function removeSeoPage(db: SeoClient, slug: string): Promise<void> {
  if (!isValidSlug(slug)) return;
  await run(db.from(SEO_TABLE).delete().eq("slug", slug));
}

// Stored results (./snapshot.ts). The public read goes through anon (RLS, and the column grants of
// 20260929010000_seo_snapshots.sql: anon may read results and results_at, never the refresh
// columns); the refresh and the admin list use the service role.

/** What a public page reads besides the page itself. */
export const SNAPSHOT_COLUMNS = "results, results_at";
const STATE_COLUMNS = "slug, query, published, results, results_at";
const ROW_COLUMNS = "slug, published, results_at, refresh_attempted_at, refresh_error";
const STATUS_COLUMNS = "slug, results, results_at, refresh_attempted_at, refresh_error";

/** A page's stored results as read, results_at exactly as the database returned it. */
export interface StoredSnapshot {
  results: unknown;
  resultsAt: string | null;
}

/** Kept as the database wrote it: the write's compare-and-set needs the same value back. */
const rawTimestamp = z.string().refine((s) => Number.isFinite(Date.parse(s)));
const optionalTimestamp = z
  .string()
  .nullable()
  .transform((s) => {
    const t = s === null ? Number.NaN : Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  });
const note = z
  .string()
  .nullable()
  .transform((s) => (s?.trim() ? s.trim() : null));

const snapshotRowSchema = z.object({ results: z.unknown(), results_at: rawTimestamp.nullable() });

/** The stored results of a published page, or null (no page, a draft, nothing stored). */
export async function selectPublishedSnapshot(
  db: SeoClient,
  slug: string,
): Promise<StoredSnapshot | null> {
  if (!isValidSlug(slug)) return null;
  const data = await run(
    db
      .from(SEO_TABLE)
      .select(SNAPSHOT_COLUMNS)
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle(),
  );
  const row = data ? snapshotRowSchema.safeParse(data) : null;
  return row?.success ? { results: row.data.results, resultsAt: row.data.results_at } : null;
}

/** The admin list's view of a page's stored results and last refresh. */
export interface SnapshotStatusRow {
  results: unknown;
  resultsAt: string | null;
  /** When the last refresh started (ISO). */
  attemptedAt: string | null;
  /** seo_pages.refresh_error: why it stored nothing, or "degraded". */
  note: string | null;
}

const statusRowSchema = z.object({
  slug: z.string(),
  results: z.unknown(),
  results_at: optionalTimestamp,
  refresh_attempted_at: optionalTimestamp,
  refresh_error: note,
});

/** Every page's stored results and last refresh, by slug (admin). */
export async function selectSnapshotStatuses(
  db: SeoClient,
): Promise<Map<string, SnapshotStatusRow>> {
  const data = await run(db.from(SEO_TABLE).select(STATUS_COLUMNS).limit(LIST_LIMIT));
  const statuses = new Map<string, SnapshotStatusRow>();
  for (const row of Array.isArray(data) ? data : []) {
    const parsed = statusRowSchema.safeParse(row);
    if (!parsed.success) continue;
    const r = parsed.data;
    statuses.set(r.slug, {
      results: r.results,
      resultsAt: r.results_at,
      attemptedAt: r.refresh_attempted_at,
      note: r.refresh_error,
    });
  }
  return statuses;
}

const stateRowSchema = z.object({
  slug: z.string().refine(isValidSlug),
  query: z.string().min(1),
  published: z.boolean(),
  results: z.unknown(),
  results_at: rawTimestamp.nullable(),
});

const refreshRowSchema = z.object({
  slug: z.string().refine(isValidSlug),
  published: z.boolean(),
  results_at: optionalTimestamp,
  refresh_attempted_at: optionalTimestamp,
  refresh_error: note,
});

/** Rows the update touched: [] when its conditions matched nothing. */
function touched(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}

/** The refresh's reads and writes on seo_pages (service role). Every method throws SeoDbError. */
export function supabaseSnapshotStore(db: SeoClient): SnapshotStore {
  return {
    async readState(slug: string): Promise<RefreshState | null> {
      if (!isValidSlug(slug)) return null;
      const data = await run(
        db.from(SEO_TABLE).select(STATE_COLUMNS).eq("slug", slug).maybeSingle(),
      );
      const row = data ? stateRowSchema.safeParse(data) : null;
      if (!row?.success) return null;
      const { results_at, ...rest } = row.data;
      return { ...rest, resultsAt: results_at };
    },

    async claim(slug: string, at: Date, windowMs: number): Promise<boolean> {
      const before = new Date(at.getTime() - windowMs).toISOString();
      const data = await run(
        db
          .from(SEO_TABLE)
          .update({ refresh_attempted_at: at.toISOString() })
          .eq("slug", slug)
          .eq("published", true)
          .or(`refresh_attempted_at.is.null,refresh_attempted_at.lt.${before}`)
          .select("slug"),
      );
      return touched(data);
    },

    async store(write: SnapshotWrite): Promise<boolean> {
      const results: StoredSeoResults = write.results;
      const update = db
        .from(SEO_TABLE)
        .update({ results, results_at: write.resultsAt, refresh_error: write.note })
        .eq("slug", write.slug)
        .eq("query", write.query);
      const data = await run(
        (write.expectedResultsAt === null
          ? update.is("results_at", null)
          : update.eq("results_at", write.expectedResultsAt)
        ).select("slug"),
      );
      return touched(data);
    },

    async recordNote(slug: string, query: string, text: string): Promise<void> {
      await run(
        db.from(SEO_TABLE).update({ refresh_error: text }).eq("slug", slug).eq("query", query),
      );
    },

    async refreshRows(): Promise<RefreshRow[]> {
      const data = await run(
        db.from(SEO_TABLE).select(ROW_COLUMNS).eq("published", true).limit(LIST_LIMIT),
      );
      return (Array.isArray(data) ? data : []).flatMap((row) => {
        const parsed = refreshRowSchema.safeParse(row);
        if (!parsed.success) return [];
        const r = parsed.data;
        return [
          {
            slug: r.slug,
            published: r.published,
            resultsAt: r.results_at,
            attemptedAt: r.refresh_attempted_at,
            error: r.refresh_error,
          },
        ];
      });
    },
  };
}
