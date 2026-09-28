import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { GuardUnavailableError, israelDayWindow } from "@/lib/guard/rate-limit";
import { adminLoginKey } from "@/lib/admin/login-rate";
import { allowNewsletterSignup, NEWSLETTER_SIGNUPS_PER_DAY, newsletterRateKey } from "./rate-limit";

const HASH = "a".repeat(64);

function fakeDb(result?: { data: unknown; error: { message: string } | null }) {
  const counts = new Map<string, number>();
  const calls: { fn: string; args: { p_key: string; p_window_start: string } }[] = [];
  const db = {
    async rpc(fn: string, args: { p_key: string; p_window_start: string }) {
      calls.push({ fn, args });
      if (result) return result;
      const key = `${args.p_key}@${args.p_window_start}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { data: counts.get(key), error: null };
    },
  } as unknown as Pick<SupabaseClient, "rpc">;
  return { db, calls };
}

describe("newsletterRateKey", () => {
  it("has its own prefix, with the env's prefix outside production", () => {
    expect(newsletterRateKey(HASH, "production")).toBe(`nl:${HASH}`);
    expect(newsletterRateKey(HASH, "preview")).toBe(`preview:nl:${HASH}`);
    expect(newsletterRateKey(HASH, "development")).toBe(`dev:nl:${HASH}`);
  });

  it("never collides with the search or admin sign-in counters", () => {
    for (const other of [`h:${HASH}`, `d:${HASH}`, adminLoginKey(HASH), "llm:day"]) {
      expect(newsletterRateKey(HASH, "production")).not.toBe(other);
    }
  });

  it("is a day-window key for the retention job (not an hour key)", () => {
    // run_retention() treats keys matching this as hour windows; every other key as an Israel day.
    const hourKey = /^((dev|preview):)?(h|al):/;
    for (const env of ["production", "preview", "development"] as const) {
      expect(hourKey.test(newsletterRateKey(HASH, env))).toBe(false);
    }
  });
});

describe("allowNewsletterSignup", () => {
  it(`allows ${NEWSLETTER_SIGNUPS_PER_DAY} per Israel day, counted in the day's window`, async () => {
    const { db, calls } = fakeDb();
    const now = new Date("2026-09-28T21:30:00Z"); // 00:30 on the 29th in Israel
    for (let i = 0; i < NEWSLETTER_SIGNUPS_PER_DAY; i++) {
      expect(await allowNewsletterSignup(db, HASH, now, "production")).toBe(true);
    }
    expect(await allowNewsletterSignup(db, HASH, now, "production")).toBe(false);
    expect(calls[0]).toEqual({
      fn: "bump_counter",
      args: { p_key: `nl:${HASH}`, p_window_start: israelDayWindow(now).start.toISOString() },
    });
    expect(israelDayWindow(now).start.toISOString()).toBe("2026-09-28T21:00:00.000Z");
  });

  it("throws GuardUnavailableError when the counter fails or returns no number", async () => {
    await expect(
      allowNewsletterSignup(fakeDb({ data: null, error: { message: "x" } }).db, HASH, new Date()),
    ).rejects.toBeInstanceOf(GuardUnavailableError);
    await expect(
      allowNewsletterSignup(fakeDb({ data: "1", error: null }).db, HASH, new Date()),
    ).rejects.toBeInstanceOf(GuardUnavailableError);
    const throwing = {
      rpc: () => {
        throw new Error("network");
      },
    } as unknown as Pick<SupabaseClient, "rpc">;
    await expect(allowNewsletterSignup(throwing, HASH, new Date())).rejects.toBeInstanceOf(
      GuardUnavailableError,
    );
  });
});
