import { formatIls } from "@/lib/format";
import type { ResultProduct } from "@/lib/types";

const SIZES = {
  lg: "text-4xl",
  md: "text-2xl",
  sm: "text-lg",
} as const;

type PriceFields = Pick<
  ResultProduct,
  "price_ils" | "original_price_ils" | "price_is_approx" | "discount_pct"
>;

export function Price({
  product,
  size = "md",
}: {
  product: PriceFields;
  size?: keyof typeof SIZES;
}) {
  const { price_ils, original_price_ils, price_is_approx, discount_pct } = product;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className={`font-bold leading-none text-ink ${SIZES[size]}`}>
        {price_is_approx && <span className="sr-only">מחיר משוער: </span>}
        <bdi dir="ltr">{formatIls(price_ils, price_is_approx)}</bdi>
      </span>
      {original_price_ils !== null && original_price_ils > price_ils && (
        <s className="text-sm text-muted">
          <span className="sr-only">במקום </span>
          <bdi dir="ltr">{formatIls(original_price_ils, price_is_approx)}</bdi>
        </s>
      )}
      {discount_pct !== null && discount_pct > 0 && (
        <span className="rounded-full bg-gold px-2.5 py-0.5 text-xs font-bold text-on-gold">
          <bdi dir="ltr">{discount_pct}%</bdi> הנחה
        </span>
      )}
    </div>
  );
}
