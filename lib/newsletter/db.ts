// Queries against public.newsletter_subscribers (supabase/migrations/20260929000000_newsletter.sql),
// taking the Supabase client as a parameter so they can be tested with a fake. The service role
// only: the table has RLS on, no policies and no grants to anon or authenticated.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const NEWSLETTER_TABLE = "newsletter_subscribers";

/** A newsletter read or write failed. The message names the operation, never a value. */
export class NewsletterDbError extends Error {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`newsletter ${operation} failed`, options);
    this.name = "NewsletterDbError";
  }
}

export type NewsletterClient = Pick<SupabaseClient, "rpc" | "from">;

export interface NewSubscriber {
  /** Normalized (trimmed, lowercased): the table's unique key. */
  email: string;
  consentText: string;
  consentVersion: string;
  source: string;
  /** Used only when the address is new; an existing row keeps its token. */
  token: string;
}

/**
 * Subscribes an address (public.newsletter_subscribe). Idempotent: a new address is inserted; one
 * that is subscribed stays as it is (its first consent and token kept); one that unsubscribed is
 * subscribed again with this consent. The caller cannot tell which happened, so neither can the
 * visitor. Throws NewsletterDbError.
 */
export async function upsertSubscriber(
  db: Pick<SupabaseClient, "rpc">,
  row: NewSubscriber,
): Promise<void> {
  let error: unknown;
  try {
    ({ error } = await db.rpc("newsletter_subscribe", {
      p_email: row.email,
      p_consent_text: row.consentText,
      p_consent_version: row.consentVersion,
      p_source: row.source,
      p_token: row.token,
    }));
  } catch (err) {
    error = err;
  }
  if (error) throw new NewsletterDbError("subscribe", { cause: error });
}

export const UNSUBSCRIBE_RESULTS = ["unsubscribed", "already", "unknown"] as const;
export type UnsubscribeResult = (typeof UNSUBSCRIBE_RESULTS)[number];

/**
 * Marks the token's row unsubscribed (public.newsletter_unsubscribe): "unsubscribed" now,
 * "already" before (the row keeps its first unsubscribed_at), "unknown" for no such token.
 * Throws NewsletterDbError.
 */
export async function unsubscribeByToken(
  db: Pick<SupabaseClient, "rpc">,
  token: string,
): Promise<UnsubscribeResult> {
  let result: { data: unknown; error: unknown };
  try {
    result = await db.rpc("newsletter_unsubscribe", { p_token: token });
  } catch (err) {
    result = { data: null, error: err };
  }
  if (result.error) throw new NewsletterDbError("unsubscribe", { cause: result.error });
  const parsed = z.enum(UNSUBSCRIBE_RESULTS).safeParse(result.data);
  if (!parsed.success) throw new NewsletterDbError("unsubscribe (result shape)");
  return parsed.data;
}

export interface SubscriberCounts {
  active: number;
  unsubscribed: number;
}

async function count(db: Pick<SupabaseClient, "from">, unsubscribed: boolean): Promise<number> {
  const query = db.from(NEWSLETTER_TABLE).select("id", { count: "exact", head: true });
  const { count: n, error } = await (unsubscribed
    ? query.not("unsubscribed_at", "is", null)
    : query.is("unsubscribed_at", null));
  if (error || typeof n !== "number") throw new NewsletterDbError("count", { cause: error });
  return n;
}

/** Active and unsubscribed rows. Throws NewsletterDbError. */
export async function countSubscribers(
  db: Pick<SupabaseClient, "from">,
): Promise<SubscriberCounts> {
  const [active, unsubscribed] = await Promise.all([count(db, false), count(db, true)]);
  return { active, unsubscribed };
}

const listRowSchema = z.object({
  email: z.string(),
  consented_at: z.string(),
  source: z.string(),
  consent_version: z.string(),
});

/** An active subscriber as the admin list and the CSV show it. */
export interface SubscriberRow {
  email: string;
  /** When the current consent was given (ISO). */
  consentedAt: string;
  source: string;
  consentVersion: string;
}

const LIST_COLUMNS = "email, consented_at, source, consent_version";

/**
 * Active subscribers, rows [offset, offset + limit): newest consent first (the admin list) or
 * oldest first (the export, so sign-ups arriving while it reads land after the pages it has
 * read). The order is total (consented_at, then id). Throws NewsletterDbError.
 */
export async function selectActiveSubscribers(
  db: Pick<SupabaseClient, "from">,
  offset: number,
  limit: number,
  order: "newest" | "oldest" = "newest",
): Promise<SubscriberRow[]> {
  const ascending = order === "oldest";
  const { data, error } = await db
    .from(NEWSLETTER_TABLE)
    .select(LIST_COLUMNS)
    .is("unsubscribed_at", null)
    .order("consented_at", { ascending })
    .order("id", { ascending })
    .range(offset, offset + limit - 1);
  if (error) throw new NewsletterDbError("list", { cause: error });
  const rows = z.array(listRowSchema).safeParse(data ?? []);
  if (!rows.success) throw new NewsletterDbError("list (row shape)");
  return rows.data.map((r) => ({
    email: r.email,
    consentedAt: r.consented_at,
    source: r.source,
    consentVersion: r.consent_version,
  }));
}

/** PostgREST returns at most 1000 rows per request on Supabase: the export reads in pages. */
export const EXPORT_CHUNK = 1000;

/** Every active subscriber, oldest consent first. Throws NewsletterDbError. */
export async function selectAllActiveSubscribers(
  db: Pick<SupabaseClient, "from">,
  chunk = EXPORT_CHUNK,
): Promise<SubscriberRow[]> {
  const all: SubscriberRow[] = [];
  for (let offset = 0; ; offset += chunk) {
    const rows = await selectActiveSubscribers(db, offset, chunk, "oldest");
    all.push(...rows);
    if (rows.length < chunk) return all;
  }
}
