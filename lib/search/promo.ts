// The "קוד הנחה" badge of a result card (components/card-badges.tsx): a cached result set lives up
// to 14 days, so whether its products' AliExpress promo codes are valid is decided when the results
// are sent, not when they were cached.
import type { ResultProduct } from "@/lib/types";

/** The AliExpress promo code is valid at `now` (ms) by its own dates; an open end counts as valid. */
export function promoCodeValid(code: ResultProduct["promo_code"], now: number): boolean {
  if (!code) return false;
  if (code.starts_at && Date.parse(code.starts_at) > now) return false;
  return !code.ends_at || Date.parse(code.ends_at) > now;
}

/** `results` with promo_code_valid set for `now` (ms). */
export function withPromoValidity<T extends ResultProduct>(
  results: readonly T[],
  now: number,
): T[] {
  return results.map((r) => ({ ...r, promo_code_valid: promoCodeValid(r.promo_code, now) }));
}
