import { Lightbulb } from "lucide-react";
import { card } from "./styles";

export const TIPS_NOTE = "טיפים כלליים לקטגוריה, לא בדיקה של המוצר הזה.";

/** "טיפים כלליים לקניית אוזניות", or a generic heading when we have no Hebrew category name. */
export function tipsHeading(categoryHe: string | null): string {
  return categoryHe ? `טיפים כלליים לקניית ${categoryHe}` : "טיפים כלליים לקנייה בקטגוריה הזו";
}

/**
 * Generic buying tips for the product's category (LLM-written, cached per category). Labelled
 * clearly as generic: they say nothing about this particular product.
 */
export function CategoryTips({
  tips,
  categoryHe,
  wide = false,
  className = "",
}: {
  tips: string[];
  categoryHe: string | null;
  /** Full page width: the tips in two columns from md, so no line runs too long to read. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="tips-title"
      className={`${card} space-y-4 p-6 ${wide ? "sm:p-8" : ""} ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Lightbulb aria-hidden className="size-5" />
        </span>
        <div className="space-y-1">
          <h2 id="tips-title" className="font-display text-2xl text-balance">
            {tipsHeading(categoryHe)}
          </h2>
          <p className="text-sm text-muted">{TIPS_NOTE}</p>
        </div>
      </div>
      <ul className={wide ? "grid gap-x-10 gap-y-3 md:grid-cols-2" : "space-y-3"}>
        {tips.map((tip) => (
          <li key={tip} className="flex items-start gap-3 leading-relaxed">
            <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
