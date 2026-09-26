// USD→ILS representative rate from the Bank of Israel public API (no key needed).
// AliExpress returns ILS prices directly (target_currency=ILS), so this is only a fallback for
// products that come back in USD. Rates publish once per Israeli business day; on weekends and
// holidays the endpoint keeps returning the last fixing.
import { z } from "zod";

export const BOI_USD_URL = "https://boi.org.il/PublicApi/GetExchangeRate?key=USD";

const boiSchema = z.object({
  key: z.literal("USD"),
  currentExchangeRate: z.number().positive(),
  unit: z.number().positive(),
  lastUpdate: z.string().min(1),
});

export interface UsdIlsRate {
  rate: number;
  /** When BoI published this fixing (UTC ISO string). */
  publishedAt: string;
  source: "boi" | "fallback";
}

export function parseBoiRate(body: unknown): UsdIlsRate {
  const r = boiSchema.parse(body);
  return { rate: r.currentExchangeRate / r.unit, publishedAt: r.lastUpdate, source: "boi" };
}

/** Fetches today's rate; falls back to the configured rate if BoI is unreachable or malformed. */
export async function fetchUsdIlsRate(
  fallbackRate: number,
  fetchImpl: typeof fetch = fetch,
): Promise<UsdIlsRate> {
  try {
    const res = await fetchImpl(BOI_USD_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`BoI HTTP ${res.status}`);
    return parseBoiRate(await res.json());
  } catch {
    return { rate: fallbackRate, publishedAt: new Date(0).toISOString(), source: "fallback" };
  }
}

export interface IlsPrice {
  ils: number;
  /** True when we converted it ourselves, so the UI must show ≈. */
  approx: boolean;
}

export function toIls(amount: number, currency: string, usdIls: number): IlsPrice | null {
  if (currency === "ILS") return { ils: amount, approx: false };
  if (currency === "USD") return { ils: Math.round(amount * usdIls * 100) / 100, approx: true };
  return null; // unknown currency: never guess
}
