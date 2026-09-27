import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { TIPS_VERSION } from "@/lib/llm/tips";
import {
  displayableTips,
  isStale,
  readCategoryTips,
  TIPS_MAX_AGE_MS,
  TipsStoreError,
  writeCategoryTips,
} from "./store";

// lib/supabase/server is server-only; the tests pass their own client.
vi.mock("server-only", () => ({}));

type Row = { category_id: string; tips_he: unknown; updated_at: string };

/** Just enough of the PostgREST builder for category_tips: select().eq().maybeSingle() and upsert(). */
class FakeDb {
  rows = new Map<string, Row>();
  upserts: { row: Row; options: unknown }[] = [];
  mode: "ok" | "error" | "throw" = "ok";

  from(table: string) {
    if (table !== "category_tips") throw new Error(`unexpected table ${table}`);
    if (this.mode === "throw") throw new TypeError("fetch failed");
    const answer = <T>(data: T) =>
      Promise.resolve(
        this.mode === "error"
          ? { data: null, error: { message: "permission denied" } }
          : { data, error: null },
      );
    let key = "";
    const query = {
      select: () => query,
      eq: (_column: string, value: string) => {
        key = value;
        return query;
      },
      maybeSingle: () => {
        const row = this.rows.get(key);
        return answer(row ? { tips_he: row.tips_he, updated_at: row.updated_at } : null);
      },
      upsert: (row: Row, options: unknown) => {
        this.upserts.push({ row, options });
        if (this.mode === "ok") this.rows.set(row.category_id, row);
        return answer(null);
      },
    };
    return query;
  }

  client() {
    return this as unknown as SupabaseClient;
  }
}

const NOW = new Date("2026-09-27T10:00:00Z");
const DAY = 24 * 3_600_000;
const TIPS = ["בדקו את המידות לפני ההזמנה.", "חפשו עמידות למים לפי תקן כמו IPX7."];

describe("category_tips store", () => {
  it("writes { v, category_en, tips } with updated_at and reads it back fresh", async () => {
    const db = new FakeDb();
    await writeCategoryTips(
      "100000306",
      { categoryEn: "Portable Audio & Video", tips: TIPS },
      NOW,
      db.client(),
    );

    expect(db.upserts).toEqual([
      {
        row: {
          category_id: "100000306",
          tips_he: { v: TIPS_VERSION, category_en: "Portable Audio & Video", tips: TIPS },
          updated_at: NOW.toISOString(),
        },
        options: { onConflict: "category_id" },
      },
    ]);
    const entry = await readCategoryTips("100000306", NOW, db.client());
    expect(entry).toEqual({
      categoryId: "100000306",
      categoryEn: "Portable Audio & Video",
      tips: TIPS,
      version: TIPS_VERSION,
      updatedAt: NOW.toISOString(),
      stale: false,
    });
    expect(displayableTips(entry)).toEqual(TIPS);
  });

  it("returns null for a missing or malformed row", async () => {
    const db = new FakeDb();
    expect(await readCategoryTips("44", NOW, db.client())).toBeNull();
    db.rows.set("44", {
      category_id: "44",
      tips_he: ["not", "an", "entry"],
      updated_at: NOW.toISOString(),
    });
    expect(await readCategoryTips("44", NOW, db.client())).toBeNull();
    expect(displayableTips(null)).toBeNull();
  });

  it("marks entries older than 30 days as stale but still shows them", async () => {
    const db = new FakeDb();
    const written = new Date(NOW.getTime() - 29 * DAY);
    await writeCategoryTips("1511", { categoryEn: "Watches", tips: TIPS }, written, db.client());
    expect((await readCategoryTips("1511", NOW, db.client()))?.stale).toBe(false);

    const later = new Date(written.getTime() + TIPS_MAX_AGE_MS);
    const old = await readCategoryTips("1511", later, db.client());
    expect(old?.stale).toBe(true);
    expect(displayableTips(old)).toEqual(TIPS);
  });

  it("treats another version as stale and does not show it", async () => {
    const db = new FakeDb();
    db.rows.set("1511", {
      category_id: "1511",
      tips_he: { v: TIPS_VERSION + 1, category_en: "Watches", tips: TIPS },
      updated_at: NOW.toISOString(),
    });
    const entry = await readCategoryTips("1511", NOW, db.client());
    expect(entry?.stale).toBe(true);
    expect(displayableTips(entry)).toBeNull();
  });

  it("does not show an empty entry (the model had too few good tips)", async () => {
    const db = new FakeDb();
    await writeCategoryTips("1511", { categoryEn: "Watches", tips: [] }, NOW, db.client());
    const entry = await readCategoryTips("1511", NOW, db.client());
    expect(entry?.stale).toBe(false);
    expect(displayableTips(entry)).toBeNull();
  });

  it("isStale: bad dates are stale", () => {
    expect(isStale(TIPS_VERSION, "not a date", NOW)).toBe(true);
    expect(isStale(TIPS_VERSION, NOW.toISOString(), NOW)).toBe(false);
  });

  it("throws TipsStoreError when the database fails", async () => {
    const db = new FakeDb();
    db.mode = "error";
    await expect(readCategoryTips("44", NOW, db.client())).rejects.toBeInstanceOf(TipsStoreError);
    await expect(
      writeCategoryTips("44", { categoryEn: "x", tips: TIPS }, NOW, db.client()),
    ).rejects.toBeInstanceOf(TipsStoreError);
    db.mode = "throw";
    await expect(readCategoryTips("44", NOW, db.client())).rejects.toBeInstanceOf(TipsStoreError);
    await expect(
      writeCategoryTips("44", { categoryEn: "x", tips: TIPS }, NOW, db.client()),
    ).rejects.toBeInstanceOf(TipsStoreError);
  });
});
