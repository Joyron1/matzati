// What the bot remembers between messages: the user's last search (so "עוד", a sort or a removed
// filter can repeat it) and the ids of messages already handled (Meta retries a POST it did not get
// a fast 200 for, and one message must never run a search twice). Both live 48 hours at most
// (supabase/migrations/20260929120000_whatsapp.sql) and are keyed by a salted hash, never the
// phone number.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashIp } from "@/lib/guard/rate-limit";
import type { SortPreference } from "@/lib/types";

export interface Session {
  /** The text the user typed for the last search. */
  q: string;
  /** Chip ids removed so far. */
  without: string[];
  sort?: SortPreference;
  /** Handle of the results cache entry ("עוד 5"); null when the last answer had no results. */
  filtersKey: string | null;
  /** Page of results last shown (0 = the first five). */
  page: number;
  moreAvailable: boolean;
  /** The order the last answer was ranked in (the buttons offer the other two). */
  shownSort?: SortPreference;
}

export interface SessionStore {
  get(userHash: string): Promise<Session | null>;
  set(userHash: string, session: Session): Promise<void>;
  clear(userHash: string): Promise<void>;
  /** True the first time `messageId` is seen; false for a redelivery. */
  claim(messageId: string): Promise<boolean>;
}

/** sha256("wa:" + wa_id + salt): the user's identity in our tables and rate-limit counters. */
export function userHashOf(waId: string, salt: string): string {
  return hashIp(`wa:${waId}`, salt);
}

/**
 * Headers that make searchForRequest rate-limit by user instead of by IP: every WhatsApp request
 * reaches us from Meta's servers, so an IP limit would be one limit for everybody. The value is
 * hashed again (with the same salt) before it is stored as a counter key.
 */
export function rateLimitHeaders(userHash: string): Headers {
  return new Headers({ "x-forwarded-for": `wa:${userHash}` });
}

const isSession = (v: unknown): v is Session =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Session).q === "string" &&
  Array.isArray((v as Session).without) &&
  typeof (v as Session).page === "number";

export class SupabaseSessionStore implements SessionStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(userHash: string): Promise<Session | null> {
    const { data, error } = await this.db
      .from("whatsapp_sessions")
      .select("state, updated_at")
      .eq("user_hash", userHash)
      .maybeSingle();
    if (error || !data) return null;
    // Older than the WhatsApp service window (24 h): the conversation is over.
    if (Date.now() - Date.parse(data.updated_at as string) > 24 * 3_600_000) return null;
    return isSession(data.state) ? data.state : null;
  }

  async set(userHash: string, session: Session): Promise<void> {
    const { error } = await this.db
      .from("whatsapp_sessions")
      .upsert({ user_hash: userHash, state: session, updated_at: new Date().toISOString() });
    if (error) throw new Error(`whatsapp_sessions write failed: ${error.message}`);
  }

  async clear(userHash: string): Promise<void> {
    await this.db.from("whatsapp_sessions").delete().eq("user_hash", userHash);
  }

  async claim(messageId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("whatsapp_seen")
      .upsert({ message_id: messageId }, { onConflict: "message_id", ignoreDuplicates: true })
      .select("message_id");
    // On a database failure, answer rather than stay silent: a duplicate reply is the lesser evil.
    if (error) return true;
    return (data?.length ?? 0) > 0;
  }
}

/** In memory, for tests. */
export class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, Session>();
  readonly seen = new Set<string>();
  async get(userHash: string) {
    return this.sessions.get(userHash) ?? null;
  }
  async set(userHash: string, session: Session) {
    this.sessions.set(userHash, session);
  }
  async clear(userHash: string) {
    this.sessions.delete(userHash);
  }
  async claim(messageId: string) {
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    return true;
  }
}
