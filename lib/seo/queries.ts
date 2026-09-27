// Reads for public pages and writes for the admin (service role, after requireAdmin()).
// Public reads use the anon key on purpose: RLS ("anon may only select published seo pages") then
// guards them too, so a bug in a filter here can never publish a draft. The query builders live
// in lib/seo/db.ts and are tested with a fake client.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { serviceClient } from "@/lib/supabase/server";
import {
  insertSeoPage,
  removeSeoPage,
  selectAllSeoPages,
  selectPublishedSeoPage,
  selectPublishedSeoPages,
  selectResultsFetchedAt,
  selectSeoPage,
  updateSeoPage,
  type SeoPage,
  type SeoPageInput,
} from "./db";
import { validateSeoInput, type SeoFieldErrors } from "./schema";

export {
  SeoDbError,
  SeoPageNotFoundError,
  SeoSlugTakenError,
  type SeoPage,
  type SeoPageInput,
} from "./db";

/** saveSeoPage was given input that fails validation. `errors` are Hebrew, per field. */
export class SeoValidationError extends Error {
  constructor(readonly errors: SeoFieldErrors) {
    super(`invalid seo page input: ${Object.keys(errors).join(", ")}`);
    this.name = "SeoValidationError";
  }
}

/** Cache tag for everything derived from published landing pages (the home list). */
export const SEO_TAG = "seo-pages";
/** How many landing pages the home page links to. */
export const POPULAR_LIMIT = 8;

let anonClient: SupabaseClient | undefined;

/** Anon-key client for public reads: RLS applies, no session is stored or refreshed. */
function publicClient(): SupabaseClient {
  if (anonClient) return anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  anonClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return anonClient;
}

function logError(where: string, err: unknown) {
  // Name and message only: no stack traces, and our errors never carry secret values.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[seo] ${where}: ${text.slice(0, 300)}`);
}

// Public reads.

/** The published landing page for this slug, or null. Throws when the database fails. */
export async function getPublishedSeoPage(slug: string): Promise<SeoPage | null> {
  return selectPublishedSeoPage(publicClient(), slug);
}

/** Every published landing page, newest first (sitemap). Throws when the database fails. */
export async function listPublishedSeoPages(): Promise<SeoPage[]> {
  return selectPublishedSeoPages(publicClient());
}

export interface PopularSearch {
  slug: string;
  title_he: string;
}

// Errors are thrown inside, so a failure is never cached; popularSearches() turns it into [].
const cachedPopular = unstable_cache(
  async (): Promise<PopularSearch[]> =>
    (await selectPublishedSeoPages(publicClient(), POPULAR_LIMIT)).map(({ slug, title_he }) => ({
      slug,
      title_he,
    })),
  ["popular-seo-pages"],
  { revalidate: 600, tags: [SEO_TAG] },
);

/**
 * Up to 8 published landing pages for the home "חיפושים פופולריים" list. Cached for 10 minutes
 * and refreshed at once when an admin changes a page. A failure reads as "none", so the home page
 * simply hides the section.
 */
export async function popularSearches(): Promise<PopularSearch[]> {
  try {
    return await cachedPopular();
  } catch (err) {
    logError("popular", err);
    return [];
  }
}

/**
 * When the results a landing page shows were fetched from AliExpress (ISO), or null when unknown.
 * Never throws: the date is left out rather than failing the page.
 */
export async function resultsFetchedAt(filtersKey: string | undefined): Promise<string | null> {
  if (!filtersKey) return null;
  try {
    return await selectResultsFetchedAt(serviceClient(), filtersKey);
  } catch (err) {
    logError("fetched-at", err);
    return null;
  }
}

// Admin (callers must have passed requireAdmin()).

export async function listAllSeoPages(): Promise<SeoPage[]> {
  return selectAllSeoPages(serviceClient());
}

export async function getSeoPage(slug: string): Promise<SeoPage | null> {
  return selectSeoPage(serviceClient(), slug);
}

/**
 * Creates (originalSlug undefined) or updates the page stored under originalSlug, which the input
 * may rename. Returns the saved page.
 */
export async function saveSeoPage(input: SeoPageInput, originalSlug?: string): Promise<SeoPage> {
  // Validated again here: this is the last stop before the service-role write.
  const checked = validateSeoInput(input);
  if (!checked.ok) throw new SeoValidationError(checked.errors);
  const db = serviceClient();
  return originalSlug === undefined
    ? insertSeoPage(db, checked.input)
    : updateSeoPage(db, originalSlug, checked.input);
}

export async function deleteSeoPage(slug: string): Promise<void> {
  return removeSeoPage(serviceClient(), slug);
}
