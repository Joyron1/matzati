// cachedSearchForBot (lib/search/server.ts): a crawler's search never reaches the LLM or
// AliExpress, and one that finds nothing cached writes no search_log row. The pipeline is real
// (cacheOnly); the store is in memory, and fetch and the LLM are spies that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedSearchForBot } from "@/lib/search/server";
import { MemoryStore } from "@/lib/search/store";

const m = vi.hoisted(() => ({
  store: null as unknown as MemoryStore,
  rateOk: true,
  llmBuilt: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({ getAdminUser: async () => null }));
vi.mock("@/lib/settings/queries", () => ({ shopCapMode: async () => "none" }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));
vi.mock("@/lib/guard/rate-limit", () => ({
  checkSearchRate: async () => (m.rateOk ? { ok: true } : { ok: false, retryAfterSec: 60 }),
  clientIp: () => "203.0.113.7",
  hashIp: () => "hash",
  consumeDailyLlmBudget: async () => true,
}));
vi.mock("@/lib/llm/anthropic", () => ({
  AnthropicProvider: class {
    constructor() {
      m.llmBuilt();
    }
  },
}));
vi.mock("@/lib/search/supabase-store", () => ({
  SupabaseStore: class {
    constructor() {
      return m.store;
    }
  },
}));

const fetchSpy = vi.fn<typeof fetch>(async () => new Response("{}"));

beforeEach(() => {
  m.store = new MemoryStore();
  m.rateOk = true;
  m.llmBuilt.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("IP_HASH_SALT", "test-salt");
  vi.stubEnv("ALIEXPRESS_APP_KEY", "k");
  vi.stubEnv("ALIEXPRESS_APP_SECRET", "s");
  vi.stubEnv("ALIEXPRESS_TRACKING_ID", "t");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cachedSearchForBot", () => {
  it("answers null for a search nothing is cached for: no LLM, no AliExpress, no row", async () => {
    const out = await cachedSearchForBot({ q: "אוזניות לריצה" }, new Headers());
    expect(out).toBeNull();
    expect(m.llmBuilt).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.store.logs).toEqual([]);
    expect(m.store.parses.size).toBe(0);
    expect(m.store.results.size).toBe(0);
  });

  it("keeps the per-IP limit and refuses an empty or too long query", async () => {
    m.rateOk = false;
    expect(await cachedSearchForBot({ q: "כבל" }, new Headers())).toBeNull();
    m.rateOk = true;
    expect(await cachedSearchForBot({ q: "   " }, new Headers())).toBeNull();
    expect(await cachedSearchForBot({ q: "א".repeat(201) }, new Headers())).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.store.logs).toEqual([]);
  });
});
