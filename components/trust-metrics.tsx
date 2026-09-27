import { ShoppingCart, ThumbsUp } from "lucide-react";
import { formatCount, formatPct } from "@/lib/format";
import type { ResultProduct } from "@/lib/types";

type TrustFields = Pick<ResultProduct, "positive_feedback_pct" | "units_sold">;

/** `units_sold` is AliExpress's 30-day sales volume, never lifetime sales. */
export const SOLD_30D_LABEL = "נמכרו ב־30 הימים האחרונים";
const SOLD_30D_SHORT = "נמכרו ב־30 יום";

/** Only shows numbers AliExpress actually returned. Missing values are omitted, never guessed. */
export function TrustMetrics({ product, short }: { product: TrustFields; short?: boolean }) {
  const { positive_feedback_pct, units_sold } = product;
  if (positive_feedback_pct === null && units_sold === null) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
      {positive_feedback_pct !== null && (
        <li className="flex items-center gap-1.5">
          <ThumbsUp aria-hidden className="size-4 shrink-0 text-accent" />
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
          <ShoppingCart aria-hidden className="size-4 shrink-0 text-accent" />
          <span>
            <bdi dir="ltr" className="font-semibold text-ink">
              {formatCount(units_sold)}
            </bdi>{" "}
            {short ? SOLD_30D_SHORT : SOLD_30D_LABEL}
          </span>
        </li>
      )}
    </ul>
  );
}
