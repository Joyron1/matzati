// The owner settings (lib/settings): the stored shape, the admin form, the reads with their safe
// default, and the admin's write. The database, requireAdmin and Next's cache are fakes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  db: null as unknown,
  requireAdmin: vi.fn(async () => ({ email: "owner@example.com" })),
  updateTag: vi.fn<(tag: string) => void>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => m.db }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: m.requireAdmin }));
// No cache in tests: every read reaches the fake table.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: m.updateTag,
}));

import { DEFAULT_SHOP_CAP_MODE } from "@/lib/ranking/config";
import { saveShopCapMode } from "./admin";
import {
  selectSetting,
  SettingsDbError,
  upsertSetting,
  SETTINGS_TABLE,
  type SettingsClient,
} from "./db";
import { shopCapMode, shopCapSettingForAdmin } from "./queries";
import {
  parseSettingsForm,
  SETTINGS_TAG,
  SHOP_CAP_FIELD,
  SHOP_CAP_KEY,
  shopCapModeOf,
} from "./schema";

/** A fake site_settings table: one row per key, and every call recorded. */
class FakeTable {
  rows = new Map<string, { value: unknown; updated_at: string }>();
  calls: { op: string; table: string; payload?: unknown }[] = [];
  failing = false;
  client() {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, key: string) => ({
            maybeSingle: async () => {
              this.calls.push({ op: "select", table });
              if (this.failing)
                return { data: null, error: { message: "relation does not exist" } };
              return { data: this.rows.get(key) ?? null, error: null };
            },
          }),
        }),
        upsert: async (payload: { key: string; value: unknown }) => {
          this.calls.push({ op: "upsert", table, payload });
          if (this.failing) return { error: { message: "down" } };
          this.rows.set(payload.key, { value: payload.value, updated_at: "2026-09-28T23:00:00Z" });
          return { error: null };
        },
      }),
    };
  }
}

let table: FakeTable;
/** The fake as the queries' client type. */
const client = () => table.client() as unknown as SettingsClient;

beforeEach(() => {
  table = new FakeTable();
  m.db = table.client();
  m.requireAdmin.mockClear();
  m.updateTag.mockClear();
});

describe("schema", () => {
  it("reads a stored shop cap value, and nothing else", () => {
    expect(shopCapModeOf({ mode: "none" })).toBe("none");
    expect(shopCapModeOf({ mode: "max2" })).toBe("max2");
    expect(shopCapModeOf({ mode: "max3" })).toBeNull();
    expect(shopCapModeOf("max2")).toBeNull();
    expect(shopCapModeOf(null)).toBeNull();
  });

  it("parses the admin form's choice", () => {
    const form = (value?: string) => {
      const f = new FormData();
      if (value !== undefined) f.set(SHOP_CAP_FIELD, value);
      return f;
    };
    expect(parseSettingsForm(form("max2"))).toEqual({ mode: "max2" });
    expect(parseSettingsForm(form("none"))).toEqual({ mode: "none" });
    expect(parseSettingsForm(form("all"))).toBeNull();
    expect(parseSettingsForm(form())).toBeNull();
  });

  it("defaults to no shop cap", () => {
    expect(DEFAULT_SHOP_CAP_MODE).toBe("none");
  });
});

describe("db", () => {
  it("selects one key and upserts by key", async () => {
    expect(await selectSetting(client(), SHOP_CAP_KEY)).toBeNull();
    await upsertSetting(client(), SHOP_CAP_KEY, { mode: "max2" });
    expect(await selectSetting(client(), SHOP_CAP_KEY)).toEqual({
      value: { mode: "max2" },
      updatedAt: "2026-09-28T23:00:00Z",
    });
    expect(table.calls.every((c) => c.table === SETTINGS_TABLE)).toBe(true);
  });

  it("throws SettingsDbError without the stored value", async () => {
    table.failing = true;
    await expect(selectSetting(client(), SHOP_CAP_KEY)).rejects.toBeInstanceOf(SettingsDbError);
    await expect(upsertSetting(client(), SHOP_CAP_KEY, { mode: "none" })).rejects.toThrow(
      "site_settings upsert failed",
    );
  });
});

describe("shopCapMode (the search's read)", () => {
  it("reads the stored mode, and the default while none is stored", async () => {
    expect(await shopCapMode()).toBe("none");
    table.rows.set(SHOP_CAP_KEY, { value: { mode: "max2" }, updated_at: "2026-09-28T23:00:00Z" });
    expect(await shopCapMode()).toBe("max2");
  });

  it("uses the default for a value it does not know", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      table.rows.set(SHOP_CAP_KEY, { value: { mode: "max9" }, updated_at: "2026-09-28T23:00:00Z" });
      expect(await shopCapMode()).toBe(DEFAULT_SHOP_CAP_MODE);
    } finally {
      errors.mockRestore();
    }
  });

  it("never throws: a failed read is the default, and the next minute does not read again", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      table.rows.set(SHOP_CAP_KEY, { value: { mode: "max2" }, updated_at: "2026-09-28T23:00:00Z" });
      table.failing = true;
      expect(await shopCapMode()).toBe("none");
      const reads = table.calls.length;
      expect(await shopCapMode()).toBe("none");
      expect(table.calls).toHaveLength(reads);
      // A minute later it reads again.
      table.failing = false;
      vi.advanceTimersByTime(60_000);
      expect(await shopCapMode()).toBe("max2");
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0][0])).not.toContain("max2");
    } finally {
      errors.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("shopCapSettingForAdmin", () => {
  it("says whether a value is stored and when it was saved; null when it cannot read", async () => {
    expect(await shopCapSettingForAdmin()).toEqual({
      mode: "none",
      stored: false,
      updatedAt: null,
    });
    table.rows.set(SHOP_CAP_KEY, { value: { mode: "max2" }, updated_at: "2026-09-28T23:00:00Z" });
    expect(await shopCapSettingForAdmin()).toEqual({
      mode: "max2",
      stored: true,
      updatedAt: "2026-09-28T23:00:00Z",
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      table.failing = true;
      expect(await shopCapSettingForAdmin()).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });
});

describe("saveShopCapMode (the admin's write)", () => {
  it("checks the admin, validates, writes with the service role and expires the settings tag", async () => {
    expect(await saveShopCapMode({ mode: "max2" })).toBe("max2");
    expect(m.requireAdmin).toHaveBeenCalledTimes(1);
    expect(table.calls).toEqual([
      {
        op: "upsert",
        table: SETTINGS_TABLE,
        payload: { key: SHOP_CAP_KEY, value: { mode: "max2" } },
      },
    ]);
    expect(m.updateTag).toHaveBeenCalledWith(SETTINGS_TAG);
    expect(SETTINGS_TAG).toBe("settings");
  });

  it("writes nothing for a value that is not a mode, and nothing when the admin check fails", async () => {
    await expect(saveShopCapMode({ mode: "all" })).rejects.toThrow();
    await expect(saveShopCapMode({ mode: "max2", extra: "x" })).resolves.toBe("max2");
    expect(table.rows.get(SHOP_CAP_KEY)?.value).toEqual({ mode: "max2" });
    m.requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(saveShopCapMode({ mode: "none" })).rejects.toThrow("NEXT_REDIRECT");
    expect(table.rows.get(SHOP_CAP_KEY)?.value).toEqual({ mode: "max2" });
  });

  it("does not expire the cache when the write fails", async () => {
    table.failing = true;
    await expect(saveShopCapMode({ mode: "max2" })).rejects.toBeInstanceOf(SettingsDbError);
    expect(m.updateTag).not.toHaveBeenCalled();
  });
});
