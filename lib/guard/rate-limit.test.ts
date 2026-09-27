import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  checkSearchRate,
  clientIp,
  consumeDailyLlmBudget,
  GuardUnavailableError,
  hashIp,
  hourWindow,
  israelDayWindow,
  SEARCHES_PER_DAY,
  SEARCHES_PER_HOUR,
} from "./rate-limit";

/** In-memory stand-in for public.bump_counter. */
function fakeDb(opts: { fail?: boolean } = {}) {
  const counts = new Map<string, number>();
  const calls: { p_key: string; p_window_start: string }[] = [];
  const db = {
    async rpc(fn: string, args: { p_key: string; p_window_start: string }) {
      if (fn !== "bump_counter") throw new Error(`unexpected rpc ${fn}`);
      calls.push(args);
      if (opts.fail) return { data: null, error: { message: "connection refused" } };
      const key = `${args.p_key}@${args.p_window_start}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { data: next, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls, counts };
}

const iso = (d: Date) => d.toISOString();

describe("hashIp", () => {
  it("is sha256 hex of ip + salt", () => {
    const expected = createHash("sha256").update("203.0.113.7pepper").digest("hex");
    expect(hashIp("203.0.113.7", "pepper")).toBe(expected);
    expect(hashIp("203.0.113.7", "pepper")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the salt and never contains the ip", () => {
    const a = hashIp("203.0.113.7", "salt-a");
    expect(a).not.toBe(hashIp("203.0.113.7", "salt-b"));
    expect(a).not.toContain("203.0.113.7");
  });

  it("refuses an empty salt", () => {
    expect(() => hashIp("203.0.113.7", "")).toThrow();
    expect(() => hashIp("203.0.113.7", "  ")).toThrow();
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry, trimmed", () => {
    const h = new Headers({ "x-forwarded-for": "  198.51.100.4 , 10.0.0.1, 10.0.0.2" });
    expect(clientIp(h)).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(new Headers({ "x-real-ip": " 2001:DB8::1 " }))).toBe("2001:db8::1");
    expect(clientIp(new Headers({ "x-forwarded-for": " , ", "x-real-ip": "192.0.2.9" }))).toBe(
      "192.0.2.9",
    );
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("hourWindow", () => {
  it("is the UTC hour containing now", () => {
    const w = hourWindow(new Date("2026-09-27T10:59:59.999Z"));
    expect(iso(w.start)).toBe("2026-09-27T10:00:00.000Z");
    expect(iso(w.end)).toBe("2026-09-27T11:00:00.000Z");
    expect(iso(hourWindow(new Date("2026-09-27T11:00:00.000Z")).start)).toBe(
      "2026-09-27T11:00:00.000Z",
    );
  });
});

describe("israelDayWindow", () => {
  it("switches day at Israel midnight in summer time (UTC+3)", () => {
    const before = israelDayWindow(new Date("2026-09-27T20:59:59Z"));
    expect(iso(before.start)).toBe("2026-09-26T21:00:00.000Z");
    expect(iso(before.end)).toBe("2026-09-27T21:00:00.000Z");
    const after = israelDayWindow(new Date("2026-09-27T21:00:00Z"));
    expect(iso(after.start)).toBe("2026-09-27T21:00:00.000Z");
  });

  it("switches day at Israel midnight in winter time (UTC+2)", () => {
    const w = israelDayWindow(new Date("2026-12-01T22:30:00Z"));
    expect(iso(w.start)).toBe("2026-12-01T22:00:00.000Z");
    expect(iso(w.end)).toBe("2026-12-02T22:00:00.000Z");
  });

  it("crosses month and year ends", () => {
    const w = israelDayWindow(new Date("2026-12-31T23:00:00Z"));
    expect(iso(w.start)).toBe("2026-12-31T22:00:00.000Z");
    expect(iso(w.end)).toBe("2027-01-01T22:00:00.000Z");
  });

  it("has 23 hours on the spring DST day (2026-03-27)", () => {
    for (const t of ["2026-03-26T22:00:00Z", "2026-03-27T00:30:00Z", "2026-03-27T20:59:59Z"]) {
      const w = israelDayWindow(new Date(t));
      expect(iso(w.start)).toBe("2026-03-26T22:00:00.000Z");
      expect(iso(w.end)).toBe("2026-03-27T21:00:00.000Z");
    }
  });

  it("has 25 hours on the autumn DST day (2026-10-25)", () => {
    for (const t of ["2026-10-24T21:00:00Z", "2026-10-24T23:30:00Z", "2026-10-25T21:59:59Z"]) {
      const w = israelDayWindow(new Date(t));
      expect(iso(w.start)).toBe("2026-10-24T21:00:00.000Z");
      expect(iso(w.end)).toBe("2026-10-25T22:00:00.000Z");
    }
  });
});

describe("checkSearchRate", () => {
  const now = new Date("2026-09-27T10:15:00Z");

  it("counts in an hour window and an Israel-day window under separate keys", async () => {
    const { db, calls } = fakeDb();
    expect(await checkSearchRate(db, "abc", now)).toEqual({ ok: true });
    expect(calls).toEqual([
      { p_key: "h:abc", p_window_start: "2026-09-27T10:00:00.000Z" },
      { p_key: "d:abc", p_window_start: "2026-09-26T21:00:00.000Z" },
    ]);
  });

  it("allows 20 per hour, then refuses until the hour ends without eating the day quota", async () => {
    const { db, counts } = fakeDb();
    for (let i = 0; i < SEARCHES_PER_HOUR; i++) {
      expect((await checkSearchRate(db, "abc", now)).ok).toBe(true);
    }
    expect(await checkSearchRate(db, "abc", now)).toEqual({ ok: false, retryAfterSec: 45 * 60 });
    expect(await checkSearchRate(db, "abc", now)).toMatchObject({ ok: false });
    expect(counts.get("d:abc@2026-09-26T21:00:00.000Z")).toBe(SEARCHES_PER_HOUR);
    // Another IP is unaffected.
    expect(await checkSearchRate(db, "def", now)).toEqual({ ok: true });
  });

  it("refuses past 100 a day until Israel midnight", async () => {
    const { db } = fakeDb();
    const start = Date.parse("2026-09-26T21:00:00Z"); // Israel midnight, 27 Sep
    for (let i = 0; i < SEARCHES_PER_DAY; i++) {
      // 5 per hour keeps the hourly limit out of the way.
      const t = new Date(start + Math.floor(i / 5) * 3_600_000);
      expect((await checkSearchRate(db, "abc", t)).ok).toBe(true);
    }
    const late = new Date("2026-09-27T20:00:00Z");
    expect(await checkSearchRate(db, "abc", late)).toEqual({ ok: false, retryAfterSec: 3600 });
    // A new Israel day starts at 21:00Z (midnight IDT).
    expect(await checkSearchRate(db, "abc", new Date("2026-09-27T21:00:00Z"))).toEqual({
      ok: true,
    });
  });

  it("throws GuardUnavailableError when the database fails", async () => {
    const { db } = fakeDb({ fail: true });
    await expect(checkSearchRate(db, "abc", now)).rejects.toBeInstanceOf(GuardUnavailableError);
    const throwing = {
      rpc: async () => {
        throw new TypeError("fetch failed");
      },
    } as unknown as SupabaseClient;
    await expect(checkSearchRate(throwing, "abc", now)).rejects.toBeInstanceOf(
      GuardUnavailableError,
    );
  });
});

describe("consumeDailyLlmBudget", () => {
  it("allows up to cap units per Israel day on one global key", async () => {
    const { db, calls } = fakeDb();
    const now = new Date("2026-09-27T10:00:00Z");
    expect(await consumeDailyLlmBudget(db, now, 2)).toBe(true);
    expect(await consumeDailyLlmBudget(db, now, 2)).toBe(true);
    expect(await consumeDailyLlmBudget(db, now, 2)).toBe(false);
    expect(calls[0]).toEqual({ p_key: "llm:day", p_window_start: "2026-09-26T21:00:00.000Z" });
    expect(await consumeDailyLlmBudget(db, new Date("2026-09-27T21:00:01Z"), 2)).toBe(true);
  });

  it("refuses everything when the cap is 0 or invalid", async () => {
    const { db, calls } = fakeDb();
    const now = new Date("2026-09-27T10:00:00Z");
    expect(await consumeDailyLlmBudget(db, now, 0)).toBe(false);
    expect(await consumeDailyLlmBudget(db, now, Number.NaN)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("throws GuardUnavailableError when the database fails", async () => {
    const { db } = fakeDb({ fail: true });
    await expect(consumeDailyLlmBudget(db, new Date(), 10)).rejects.toBeInstanceOf(
      GuardUnavailableError,
    );
  });
});
