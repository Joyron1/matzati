// Per-IP rate limits (20/hour, 100/day on a salted IP hash; the raw IP is never stored) and the
// global daily LLM budget (DAILY_SEARCH_CAP), both counted atomically in Postgres by
// public.bump_counter (supabase/migrations/m4_rate_limit.sql).
//
// Dev and production share the database (owner decision 2026-09-28), so outside production every
// counter key gets its env's prefix ("dev:llm:day", "dev:h:<hash>"): a dev or preview run never
// uses up production's daily budget or a visitor's limits, and /admin/stats reads production's.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deployEnv, type DeployEnv } from "@/lib/env";

export const SEARCHES_PER_HOUR = 20;
export const SEARCHES_PER_DAY = 100;

const TIME_ZONE = "Asia/Jerusalem";
const HOUR_MS = 3_600_000;
const LLM_BUDGET_KEY = "llm:day";

/** Counter key prefix per env; production keeps the bare keys the stats read. */
const COUNTER_PREFIX: Record<DeployEnv, string> = {
  production: "",
  preview: "preview:",
  development: "dev:",
};

/** The counter store could not be reached. Callers decide how to answer (the guard fails closed). */
export class GuardUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardUnavailableError";
  }
}

/** sha256(ip + salt), hex. Throws on an empty salt: an unsalted IPv4 hash is trivially reversible. */
export function hashIp(ip: string, salt: string): string {
  if (!salt.trim()) throw new Error("IP_HASH_SALT is empty");
  return createHash("sha256")
    .update(ip + salt, "utf8")
    .digest("hex");
}

/** First address in x-forwarded-for, else x-real-ip, else "unknown". */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.toLowerCase();
  const real = headers.get("x-real-ip")?.trim();
  return real ? real.toLowerCase() : "unknown";
}

export interface Window {
  start: Date;
  end: Date;
}

/** The UTC hour containing `now`. Israel's offsets are whole hours, so it is also the local hour. */
export function hourWindow(now: Date): Window {
  const start = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return { start: new Date(start), end: new Date(start + HOUR_MS) };
}

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

function wallClock(ms: number) {
  const p = Object.fromEntries(
    zoneParts.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]),
  );
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** Israel's UTC offset in ms at instant `ms`. */
function offsetAt(ms: number): number {
  const w = wallClock(ms);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight. Israel changes clocks at 02:00, so midnight always exists once. */
function israelMidnight(y: number, m: number, d: number): number {
  const naive = Date.UTC(y, m - 1, d);
  const guess = naive - offsetAt(naive);
  return naive - offsetAt(guess);
}

/** The Asia/Jerusalem calendar day containing `now` (23 or 25 hours on DST change days). */
export function israelDayWindow(now: Date): Window {
  const { y, m, d } = wallClock(now.getTime());
  return { start: new Date(israelMidnight(y, m, d)), end: new Date(israelMidnight(y, m, d + 1)) };
}

async function bump(db: SupabaseClient, key: string, windowStart: Date): Promise<number> {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await db.rpc("bump_counter", {
      p_key: key,
      p_window_start: windowStart.toISOString(),
    });
  } catch (err) {
    result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
  const { data, error } = result;
  if (error || typeof data !== "number") {
    throw new GuardUnavailableError(
      `bump_counter failed: ${error?.message ?? "no count returned"}`,
    );
  }
  return data;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

const secondsUntil = (end: Date, now: Date) =>
  Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000));

/**
 * Counts one search for this IP hash in the hour and day windows; refuses past either limit.
 * The day counter is only bumped once the hour allows the search, so retries while blocked for
 * the hour do not eat the day's quota. Throws GuardUnavailableError when the database fails.
 */
export async function checkSearchRate(
  db: SupabaseClient,
  ipHash: string,
  now: Date,
  env: DeployEnv = deployEnv(),
): Promise<RateLimitResult> {
  const prefix = COUNTER_PREFIX[env];
  const hour = hourWindow(now);
  if ((await bump(db, `${prefix}h:${ipHash}`, hour.start)) > SEARCHES_PER_HOUR) {
    return { ok: false, retryAfterSec: secondsUntil(hour.end, now) };
  }
  const day = israelDayWindow(now);
  if ((await bump(db, `${prefix}d:${ipHash}`, day.start)) > SEARCHES_PER_DAY) {
    return { ok: false, retryAfterSec: secondsUntil(day.end, now) };
  }
  return { ok: true };
}

/**
 * Counts one unit of LLM work for today (Asia/Jerusalem day); false once `cap` is exceeded.
 * Throws GuardUnavailableError when the database fails.
 */
export async function consumeDailyLlmBudget(
  db: SupabaseClient,
  now: Date,
  cap: number,
  env: DeployEnv = deployEnv(),
): Promise<boolean> {
  if (!(cap > 0)) return false;
  const key = COUNTER_PREFIX[env] + LLM_BUDGET_KEY;
  return (await bump(db, key, israelDayWindow(now).start)) <= cap;
}
