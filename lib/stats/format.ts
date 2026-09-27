// Display text for /admin/stats. Costs of a few calls are fractions of a cent, so small USD
// amounts keep four decimals instead of rounding to "$0.00".
import type { LlmCallKind } from "./usage";

const usdSmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const usdLarge = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ilsFormat = new Intl.NumberFormat("he-IL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 0 → "$0.00", 0.01234 → "$0.0123", 12.345 → "$12.35". */
export function formatUsd(usd: number): string {
  return (Math.abs(usd) >= 1 ? usdLarge : usdSmall).format(usd);
}

/** 1234.5 → "₪1,234.50". A converted amount, so it keeps the agorot like a price would not. */
export function formatIlsAmount(ils: number): string {
  return `₪${ilsFormat.format(ils)}`;
}

/** Shown instead of a share when there is nothing to divide by (never as 0%). */
export const NO_SHARE = "אין";

/** 0.125 → "12.5%", 1 → "100%", null → NO_SHARE. */
export function formatShare(share: number | null): string {
  if (share === null || !Number.isFinite(share)) return NO_SHARE;
  const pct = Math.round(share * 1000) / 10;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

const dayFormat = new Intl.DateTimeFormat("he-IL", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  timeZone: "UTC",
});

/** An Israel date "2026-09-27" → "יום א׳, 27.9". The date is formatted as is, with no time zone shift. */
export function formatIsraelDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return dayFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

const KIND_LABELS: Record<LlmCallKind, string> = {
  parse: "הבנת החיפוש",
  explain: "הסבר לתוצאות",
  explain_more: "הסבר ל״עוד 3 אפשרויות״",
  tips: "טיפים לקטגוריה",
};

export function llmKindLabel(kind: LlmCallKind): string {
  return KIND_LABELS[kind];
}
