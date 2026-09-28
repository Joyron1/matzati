import { ExternalLink, MessageSquareText } from "lucide-react";
import { AffiliateNoteLink } from "./buy-button";
import { btnMd, btnSecondary, card } from "./styles";

/**
 * "ביקורות" on /p. The affiliate API returns no review text (CLAUDE.md §5.3), so the card only
 * links to the reviews on AliExpress through /go. It never summarizes, quotes or rates reviews,
 * and repeats no numbers: % positive and 30-day sales are already shown above it on the page.
 */
export function ReviewsCard({
  productId,
  className = "",
}: {
  productId: string;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="reviews-title"
      className={`${card} space-y-4 p-5 sm:p-6 ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <MessageSquareText aria-hidden className="size-5" />
        </span>
        <h2 id="reviews-title" className="font-display text-2xl">
          ביקורות
        </h2>
      </div>
      <p className="leading-relaxed">את הביקורות עצמן אפשר לקרוא בעמוד המוצר באלי אקספרס.</p>
      {/* The reviews link is an affiliate link too (it goes through /go), so it has the note. */}
      <div className="flex flex-col">
        <a
          href={`/go/${encodeURIComponent(productId)}?src=reviews`}
          target="_blank"
          rel="sponsored nofollow noopener"
          className={`${btnSecondary} ${btnMd} w-full`}
        >
          לביקורות באלי אקספרס
          <ExternalLink aria-hidden className="size-[18px]" />
          <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
        </a>
        <AffiliateNoteLink className="self-center" />
      </div>
    </section>
  );
}
