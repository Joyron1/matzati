// aliexpress.affiliate.product.shipping.get (owner request 2026-10-23: the product finder keeps
// free-shipping products). Verified with real calls on 2026-10-23 (scripts/probe-shipping.ts): it
// needs product_id, sku_id, ship_to_country, target_currency, target_language, target_sale_price
// and tax_rate, and answers {shipping_fee, min_delivery_days, max_delivery_days, delivery_days,
// ship_from_country} for that one variant. Other variants may ship at another fee.
import { z } from "zod";
import type { AliExpressClient } from "./client";
import type { AliProduct, AliShipping } from "./schemas";

const num = z.union([z.string(), z.number()]).optional();
const shippingSchema = z.object({
  shipping_fee: num,
  min_delivery_days: num,
  max_delivery_days: num,
  ship_from_country: z.string().optional(),
});

const toNumber = (v: string | number | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** True when the product can be asked: an ILS price and the default variant's id. */
export function canAskShipping(p: AliProduct): boolean {
  return p.currency === "ILS" && Boolean(p.skuId);
}

/**
 * Shipping of the product's default variant to Israel, or null when AliExpress gives no fee.
 * Throws on a gateway or network error (the caller decides).
 */
export async function getShippingToIsrael(
  client: AliExpressClient,
  p: AliProduct,
  now: Date,
): Promise<AliShipping | null> {
  if (!canAskShipping(p)) return null;
  const { result } = await client.call("aliexpress.affiliate.product.shipping.get", {
    product_id: p.productId,
    sku_id: p.skuId,
    ship_to_country: "IL",
    target_currency: "ILS",
    target_language: "EN",
    target_sale_price: p.price.toFixed(2),
    tax_rate: "0",
  });
  const parsed = shippingSchema.safeParse(result);
  if (!parsed.success) return null;
  const fee = toNumber(parsed.data.shipping_fee);
  if (fee === null || fee < 0) return null;
  return {
    feeIls: fee,
    minDays: toNumber(parsed.data.min_delivery_days),
    maxDays: toNumber(parsed.data.max_delivery_days),
    fromCountry: parsed.data.ship_from_country ?? null,
    checkedAt: now.toISOString(),
  };
}
