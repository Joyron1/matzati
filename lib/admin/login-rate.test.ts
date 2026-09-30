import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { GuardUnavailableError } from "@/lib/guard/rate-limit";
import { ADMIN_LOGINS_PER_HOUR, adminLoginKey, allowAdminLogin } from "./login-rate";

/** In-memory stand-in for public.bump_counter. */
function fakeDb(mode: "ok" | "error" | "throw" | "no-count" = "ok") {
  const counts = new Map<string, number>();
  const calls: { p_key: string; p_window_start: string }[] = [];
  const db = {
    async rpc(fn: string, args: { p_key: string; p_window_start: string }) {
      if (fn !== "bump_counter") throw new Error(`unexpected rpc ${fn}`);
      calls.push(args);
      if (mode === "throw") throw new Error("fetch failed");
      if (mode === "error") return { data: null, error: { message: "connection refused" } };
      if (mode === "no-count") return { data: null, error: null };
      const key = `${args.p_key}@${args.p_window_start}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { data: next, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const hash = "a".repeat(64);
const now = new Date("2026-09-27T12:34:56Z");

describe("allowAdminLogin", () => {
  it("allows 10 attempts per hour (passwords and links together), then refuses", async () => {
    const { db } = fakeDb();
    const results: boolean[] = [];
    for (let i = 0; i < ADMIN_LOGINS_PER_HOUR + 2; i++) {
      results.push(await allowAdminLogin(db, hash, now));
    }
    expect(ADMIN_LOGINS_PER_HOUR).toBe(10);
    expect(results).toEqual([...Array(10).fill(true), false, false]);
  });

  it("counts under al:<hash> in the UTC hour window", async () => {
    const { db, calls } = fakeDb();
    await allowAdminLogin(db, hash, now);
    expect(calls).toEqual([{ p_key: `al:${hash}`, p_window_start: "2026-09-27T12:00:00.000Z" }]);
    expect(adminLoginKey(hash)).toBe(`al:${hash}`);
  });

  it("starts over in the next hour and keeps IPs apart", async () => {
    const { db } = fakeDb();
    for (let i = 0; i < ADMIN_LOGINS_PER_HOUR; i++) await allowAdminLogin(db, hash, now);
    expect(await allowAdminLogin(db, hash, now)).toBe(false);
    expect(await allowAdminLogin(db, "b".repeat(64), now)).toBe(true);
    expect(await allowAdminLogin(db, hash, new Date("2026-09-27T13:00:00Z"))).toBe(true);
  });

  it("throws GuardUnavailableError when the counter cannot be read", async () => {
    for (const mode of ["error", "throw", "no-count"] as const) {
      await expect(allowAdminLogin(fakeDb(mode).db, hash, now)).rejects.toBeInstanceOf(
        GuardUnavailableError,
      );
    }
  });
});
