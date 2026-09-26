import { describe, expect, it, vi } from "vitest";
import { fetchUsdIlsRate, parseBoiRate, toIls } from "./boi";

// Live response captured 2026-09-26 from boi.org.il/PublicApi/GetExchangeRate?key=USD
const LIVE = {
  key: "USD",
  currentExchangeRate: 3.033,
  currentChange: -0.45946832950443058746307844,
  unit: 1,
  lastUpdate: "2026-09-25T09:23:04.8179672Z",
};

describe("parseBoiRate", () => {
  it("reads the rate per unit", () => {
    expect(parseBoiRate(LIVE)).toEqual({
      rate: 3.033,
      publishedAt: "2026-09-25T09:23:04.8179672Z",
      source: "boi",
    });
    expect(parseBoiRate({ ...LIVE, currentExchangeRate: 303.3, unit: 100 }).rate).toBeCloseTo(
      3.033,
    );
  });
  it("rejects other currencies and bad values", () => {
    expect(() => parseBoiRate({ ...LIVE, key: "EUR" })).toThrow();
    expect(() => parseBoiRate({ ...LIVE, currentExchangeRate: 0 })).toThrow();
  });
});

describe("fetchUsdIlsRate", () => {
  it("returns the BoI rate", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(LIVE)));
    await expect(fetchUsdIlsRate(3.1, f)).resolves.toMatchObject({ rate: 3.033, source: "boi" });
  });
  it("falls back when BoI fails", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 503 }));
    await expect(fetchUsdIlsRate(3.1, f)).resolves.toMatchObject({ rate: 3.1, source: "fallback" });
  });
});

describe("toIls", () => {
  it("passes ILS through as exact and marks conversions as approximate", () => {
    expect(toIls(183.7, "ILS", 3.033)).toEqual({ ils: 183.7, approx: false });
    expect(toIls(10, "USD", 3.033)).toEqual({ ils: 30.33, approx: true });
    expect(toIls(10, "CNY", 3.033)).toBeNull();
  });
});
