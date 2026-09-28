// The daily cron route (app/api/cron/seo-refresh) with a fake refresher: only Vercel Cron's
// Authorization header runs it, only in production, and it revalidates the pages it refreshed.
// No database, AliExpress or LLM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/seo-refresh/route";
import type { CronSummary } from "./refresh";

const m = vi.hoisted(() => ({
  refreshStale: vi.fn<() => Promise<CronSummary>>(),
  writesAllowed: vi.fn(() => true),
  revalidatePath: vi.fn<(path: string) => void>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/seo/refresh-server", () => ({
  seoRefresher: { refreshStale: m.refreshStale },
  snapshotWritesAllowed: m.writesAllowed,
}));

// A made-up value for the test only; never a real secret.
const SECRET = "test-cron-secret-0123456789";

const request = (authorization?: string) =>
  new Request("https://example.test/api/cron/seo-refresh", {
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  m.writesAllowed.mockReturnValue(true);
  m.refreshStale.mockResolvedValue({
    due: 3,
    stored: ["אוזניות-אלחוטיות"],
    kept: 1,
    failed: 1,
    busy: 0,
    notReached: 0,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/cron/seo-refresh", () => {
  it("refuses a request without Vercel's secret, before doing anything", async () => {
    for (const auth of [undefined, "Bearer wrong", SECRET, `Basic ${SECRET}`]) {
      const res = await GET(request(auth));
      expect(res.status).toBe(401);
    }
    expect(m.refreshStale).not.toHaveBeenCalled();
  });

  it("refuses everyone while CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(m.refreshStale).not.toHaveBeenCalled();
  });

  it("refreshes the due pages, revalidates the stored ones and answers counts only", async () => {
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      due: 3,
      stored: 1,
      kept: 1,
      failed: 1,
      busy: 0,
      not_reached: 0,
    });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/s/${encodeURIComponent("אוזניות-אלחוטיות")}`);
    expect(console.log).toHaveBeenCalledWith(
      "[seo-cron] due=3 stored=1 kept=1 failed=1 busy=0 not_reached=0",
    );
  });

  it("does nothing outside production (dev and preview share the database)", async () => {
    m.writesAllowed.mockReturnValue(false);
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(m.refreshStale).not.toHaveBeenCalled();
  });

  it("answers 500 when the pages cannot be read", async () => {
    m.refreshStale.mockRejectedValue(new Error("db down"));
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(500);
  });
});
