import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  countSubscribers,
  NewsletterDbError,
  selectActiveSubscribers,
  selectAllActiveSubscribers,
  unsubscribeByToken,
} from "./db";

interface Recorded {
  table: string;
  select?: [string, unknown];
  filters: string[];
  orders: string[];
  range?: [number, number];
}

/** A PostgREST query builder stand-in over `total` active rows, recording each query. */
function fakeFrom(total: number, opts: { error?: boolean } = {}) {
  const queries: Recorded[] = [];
  const rows = Array.from({ length: total }, (_, i) => ({
    email: `user${i}@example.com`,
    consented_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
    source: "footer",
    consent_version: "2026-09-28",
  }));
  const db = {
    from(table: string) {
      const q: Recorded = { table, filters: [], orders: [] };
      queries.push(q);
      const builder = {
        select(columns: string, options?: unknown) {
          q.select = [columns, options];
          return builder;
        },
        is(column: string, value: null) {
          q.filters.push(`${column} is ${value}`);
          return builder;
        },
        not(column: string, op: string, value: null) {
          q.filters.push(`${column} not ${op} ${value}`);
          return builder;
        },
        order(column: string, o: { ascending: boolean }) {
          q.orders.push(`${column} ${o.ascending ? "asc" : "desc"}`);
          return builder;
        },
        range(from: number, to: number) {
          q.range = [from, to];
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          if (opts.error) return resolve({ data: null, count: null, error: { message: "x" } });
          if ((q.select?.[1] as { head?: boolean } | undefined)?.head) {
            const unsub = q.filters.some((f) => f.includes("not"));
            return resolve({ data: null, count: unsub ? 3 : total, error: null });
          }
          const [from, to] = q.range ?? [0, total - 1];
          return resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  } as unknown as Pick<SupabaseClient, "from">;
  return { db, queries };
}

describe("selectActiveSubscribers", () => {
  it("reads active rows only, in a total order, one page", async () => {
    const { db, queries } = fakeFrom(120);
    const rows = await selectActiveSubscribers(db, 50, 50);
    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual({
      email: "user50@example.com",
      consentedAt: expect.any(String),
      source: "footer",
      consentVersion: "2026-09-28",
    });
    expect(queries[0]).toMatchObject({
      table: "newsletter_subscribers",
      filters: ["unsubscribed_at is null"],
      orders: ["consented_at desc", "id desc"],
      range: [50, 99],
    });
    // Never the token or the consent text: the list does not need them.
    expect(queries[0]!.select![0]).not.toMatch(/token|consent_text/);
  });

  it("throws NewsletterDbError on an error", async () => {
    await expect(selectActiveSubscribers(fakeFrom(1, { error: true }).db, 0, 50)).rejects.toThrow(
      NewsletterDbError,
    );
  });
});

describe("selectAllActiveSubscribers", () => {
  it("reads every row in pages, oldest first", async () => {
    const { db, queries } = fakeFrom(2500);
    const rows = await selectAllActiveSubscribers(db, 1000);
    expect(rows).toHaveLength(2500);
    expect(queries.map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(queries[0]!.orders).toEqual(["consented_at asc", "id asc"]);
  });

  it("stops after an exactly full page with one more read", async () => {
    const { db, queries } = fakeFrom(2000);
    expect(await selectAllActiveSubscribers(db, 1000)).toHaveLength(2000);
    expect(queries).toHaveLength(3);
  });
});

describe("countSubscribers", () => {
  it("counts active and unsubscribed rows without reading them", async () => {
    const { db, queries } = fakeFrom(42);
    expect(await countSubscribers(db)).toEqual({ active: 42, unsubscribed: 3 });
    for (const q of queries) expect(q.select).toEqual(["id", { count: "exact", head: true }]);
  });
});

describe("unsubscribeByToken", () => {
  const rpcReturning = (result: { data: unknown; error: unknown }) =>
    ({ rpc: async () => result }) as unknown as Pick<SupabaseClient, "rpc">;

  it("returns the function's answer", async () => {
    for (const answer of ["unsubscribed", "already", "unknown"]) {
      expect(await unsubscribeByToken(rpcReturning({ data: answer, error: null }), "t")).toBe(
        answer,
      );
    }
  });

  it("throws on an error or an unexpected answer", async () => {
    await expect(
      unsubscribeByToken(rpcReturning({ data: null, error: { message: "x" } }), "t"),
    ).rejects.toThrow(NewsletterDbError);
    await expect(
      unsubscribeByToken(rpcReturning({ data: "deleted", error: null }), "t"),
    ).rejects.toThrow(NewsletterDbError);
  });
});
