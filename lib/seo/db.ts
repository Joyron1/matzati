// Queries against `seo_pages` (and one read of `search_cache`), taking the Supabase client as a
// parameter so tests can pass a fake. lib/seo/queries.ts binds them to the real clients: the anon
// key for public reads (RLS only lets anon see published rows) and the service role for admin
// writes. Published is checked again in code on public reads.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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
  constructor(message: string) {
    super(message);
    this.name = "SeoDbError";
  }
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
    throw new SeoDbError(error.message);
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

// Freshness of the results a page shows (service role: search_cache is not public).

const FILTERS_KEY = /^[0-9a-f]{64}$/;

/**
 * When the results cached under this filters key were fetched from AliExpress (ISO), or null when
 * unknown. The landing page shows it as "עודכן לאחרונה".
 */
export async function selectResultsFetchedAt(
  db: SeoClient,
  filtersKey: string,
): Promise<string | null> {
  if (!FILTERS_KEY.test(filtersKey)) return null;
  const data = await run(
    db.from("search_cache").select("created_at").eq("filters_key", filtersKey).maybeSingle(),
  );
  const parsed = z.object({ created_at: timestamp }).safeParse(data);
  return parsed.success ? parsed.data.created_at : null;
}
