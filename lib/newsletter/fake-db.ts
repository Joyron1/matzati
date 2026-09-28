// Tests only: an in-memory stand-in for the newsletter's database calls (public.bump_counter and
// the two functions of 20260929000000_newsletter.sql, with the same semantics), so the sign-up
// and unsubscribe logic run without a database.
import type { NewsletterClient } from "./db";

export interface FakeRow {
  email: string;
  consent_text: string;
  consent_version: string;
  consented_at: string;
  source: string;
  unsubscribed_at: string | null;
  unsubscribe_token: string;
}

type Args = Record<string, string>;

export function fakeNewsletterDb(opts: { failCounter?: boolean; failWrite?: boolean } = {}) {
  const counts = new Map<string, number>();
  const rows = new Map<string, FakeRow>();
  const calls: { fn: string; args: Args }[] = [];
  let clock = Date.parse("2026-09-28T10:00:00Z");
  const now = () => new Date((clock += 1000)).toISOString();

  const rpc = async (fn: string, args: Args) => {
    calls.push({ fn, args });
    if (fn === "bump_counter") {
      if (opts.failCounter) return { data: null, error: { message: "connection refused" } };
      const key = `${args.p_key}@${args.p_window_start}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { data: next, error: null };
    }
    if (fn === "newsletter_subscribe") {
      if (opts.failWrite) return { data: null, error: { message: "relation does not exist" } };
      const existing = rows.get(args.p_email);
      if (!existing) {
        if ([...rows.values()].some((r) => r.unsubscribe_token === args.p_token)) {
          return { data: null, error: { message: "duplicate key (token)" } };
        }
        rows.set(args.p_email, {
          email: args.p_email,
          consent_text: args.p_consent_text,
          consent_version: args.p_consent_version,
          consented_at: now(),
          source: args.p_source,
          unsubscribed_at: null,
          unsubscribe_token: args.p_token,
        });
      } else if (existing.unsubscribed_at !== null) {
        Object.assign(existing, {
          consent_text: args.p_consent_text,
          consent_version: args.p_consent_version,
          consented_at: now(),
          source: args.p_source,
          unsubscribed_at: null,
        });
      }
      return { data: null, error: null };
    }
    if (fn === "newsletter_unsubscribe") {
      if (opts.failWrite) return { data: null, error: { message: "timeout" } };
      const row = [...rows.values()].find((r) => r.unsubscribe_token === args.p_token);
      if (!row) return { data: "unknown", error: null };
      if (row.unsubscribed_at !== null) return { data: "already", error: null };
      row.unsubscribed_at = now();
      return { data: "unsubscribed", error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  };

  const db = {
    rpc,
    from() {
      throw new Error("the sign-up must not query tables directly");
    },
  } as unknown as NewsletterClient;

  return { db, rows, counts, calls };
}
