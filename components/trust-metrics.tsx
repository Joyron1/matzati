import { ShoppingCart, ThumbsUp } from "lucide-react";
import { formatCount, formatPct } from "@/lib/format";
import type { ResultProduct, SharedNumbersMark } from "@/lib/types";

type TrustFields = Pick<ResultProduct, "positive_feedback_pct" | "units_sold" | "shared_numbers">;

/** `units_sold` is AliExpress's 30-day sales volume, never lifetime sales. */
export const SOLD_30D_LABEL = "נמכרו ב־30 הימים האחרונים";
const SOLD_30D_SHORT = "נמכרו ב־30 יום";

/**
 * Under a card's numbers when other listings of its shop show them too (shared_numbers,
 * lib/ranking/shared-numbers.ts), naming the number: true of this card, not only of its shop. The
 * feedback rule needs most of the shop's listings checked at one value; the sales rule another
 * listing with exactly the same sales, which the ranking splits between them ("most popular" too).
 * Null when this card's numbers are its own.
 */
export function sharedNumbersNote(mark: SharedNumbersMark | undefined): string | null {
  if (mark?.feedback && mark.sales) {
    return "רוב המוצרים שבדקנו מהחנות הזו מציגים בדיוק את אחוז המשוב הזה, ומוצר אחר שלה מציג גם את מספר המכירות הזה. בדירוג חילקנו את המכירות בין המוצרים שמציגים אותן.";
  }
  if (mark?.feedback) {
    return "רוב המוצרים שבדקנו מהחנות הזו מציגים בדיוק את אחוז המשוב הזה, כך שייתכן שהוא לא של המוצר הזה בלבד.";
  }
  if (mark?.sales) {
    return "מוצר אחר של החנות הזו מציג בדיוק את מספר המכירות הזה, ולכן בדירוג חילקנו אותו בין המוצרים שמציגים אותו.";
  }
  return null;
}

/**
 * Only shows numbers AliExpress actually returned. Missing values are omitted, never guessed.
 * `short` is for narrow cards: the shorter sales label, and each label kept on one line, so a
 * line breaks between the number and its label, never inside the label ("ב־30" / "יום").
 * A number other listings of the shop show too (shared_numbers) is shown as AliExpress sent it,
 * with a note that says so.
 */
export function TrustMetrics({ product, short }: { product: TrustFields; short?: boolean }) {
  const { positive_feedback_pct, units_sold, shared_numbers } = product;
  if (positive_feedback_pct === null && units_sold === null) return null;
  const list = <MetricList product={product} short={short} />;
  const note = sharedNumbersNote(shared_numbers);
  if (!note) return list;
  return (
    <div className="space-y-1.5">
      {list}
      <p className={`${short ? "text-xs" : "text-sm"} leading-relaxed text-pretty text-muted`}>
        {note}
      </p>
    </div>
  );
}

function MetricList({ product, short }: { product: TrustFields; short?: boolean }) {
  const { positive_feedback_pct, units_sold } = product;
  const label = short ? "whitespace-nowrap" : undefined;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
      {positive_feedback_pct !== null && (
        <li className="flex items-center gap-1.5">
          <ThumbsUp aria-hidden className="size-4 shrink-0 text-accent" />
          <span>
            <bdi dir="ltr" className="font-semibold text-ink">
              {formatPct(positive_feedback_pct)}
            </bdi>{" "}
            <span className={label}>משוב חיובי</span>
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
            <span className={label}>{short ? SOLD_30D_SHORT : SOLD_30D_LABEL}</span>
          </span>
        </li>
      )}
    </ul>
  );
}
