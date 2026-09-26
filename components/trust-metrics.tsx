import { ShoppingCart, ThumbsUp } from "lucide-react";
import { formatCount, formatPct } from "@/lib/format";
import type { ResultProduct } from "@/lib/types";

type TrustFields = Pick<ResultProduct, "positive_feedback_pct" | "units_sold">;

/** Only shows numbers AliExpress actually returned. Missing values are omitted, never guessed. */
export function TrustMetrics({ product }: { product: TrustFields }) {
  const { positive_feedback_pct, units_sold } = product;
  if (positive_feedback_pct === null && units_sold === null) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
      {positive_feedback_pct !== null && (
        <li className="flex items-center gap-1.5">
          <ThumbsUp aria-hidden className="size-4 text-accent" />
          <span>
            <bdi dir="ltr" className="font-semibold text-ink">
              {formatPct(positive_feedback_pct)}
            </bdi>{" "}
            משוב חיובי
          </span>
        </li>
      )}
      {units_sold !== null && (
        <li className="flex items-center gap-1.5">
          <ShoppingCart aria-hidden className="size-4 text-accent" />
          <span>
            <bdi dir="ltr" className="font-semibold text-ink">
              {formatCount(units_sold)}
            </bdi>{" "}
            נמכרו
          </span>
        </li>
      )}
    </ul>
  );
}
