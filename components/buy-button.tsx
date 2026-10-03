import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { AFFILIATE_NOTE, BUY_LABEL } from "@/lib/copy";
import { goHref } from "@/lib/search-url";
import { aboveCardLink, btnLg, btnMd, btnPrimary, btnSm } from "./styles";

interface BuyButtonProps {
  productId: string;
  /** Where the click came from, logged by /go. */
  src: string;
  /** On a result card: the uid of the search_log row that showed it, logged by /go. */
  searchUid?: string;
  /** On a result card: its 1-based rank, logged by /go. */
  position?: number;
  /** "sm": a narrow card (two in a row on a phone): the short label "לקנייה". */
  size?: "lg" | "md" | "sm";
  /** On a card the whole of which links to its product page: the button and note stand above it. */
  raised?: boolean;
  className?: string;
}

const SIZE_CLASS = { lg: btnLg, md: btnMd, sm: btnSm } as const;

/** The visible label of a small buy button; the icon and the card say it leaves for AliExpress. */
const SHORT_BUY_LABEL = "לקנייה";

/**
 * The affiliate disclosure next to a link that leaves for AliExpress through /go (CLAUDE.md §1):
 * small muted words that open the full text in the terms. The visible text is short, so the link
 * keeps a 44px hit area through its height and padding.
 */
export function AffiliateNoteLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href={AFFILIATE_NOTE.href}
      aria-label={AFFILIATE_NOTE.ariaLabel}
      className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs text-muted underline underline-offset-4 hover:text-ink ${className}`}
    >
      {AFFILIATE_NOTE.label}
    </Link>
  );
}

/** Every buy button goes through /go and has the "קישור שותפים" note right under it. */
export function BuyButton({
  productId,
  src,
  searchUid,
  position,
  size = "lg",
  raised = false,
  className = "",
}: BuyButtonProps) {
  const above = raised ? ` ${aboveCardLink}` : "";
  return (
    <div className={`flex flex-col ${className}`}>
      <a
        href={goHref(productId, src, { searchUid, position })}
        target="_blank"
        rel="sponsored nofollow noopener"
        className={`${btnPrimary} ${SIZE_CLASS[size]} w-full${above}`}
      >
        {size === "sm" ? (
          // A narrow card (two in a row on a phone, five on desktop): the full label wrapped to two
          // or three lines (2026-09-30), so it shows "לקנייה" and says the rest to screen readers.
          <>
            <span aria-hidden>{SHORT_BUY_LABEL}</span>
            <span className="sr-only">{BUY_LABEL}</span>
          </>
        ) : (
          BUY_LABEL
        )}
        <ExternalLink aria-hidden className="size-[18px] shrink-0" />
        <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
      </a>
      <AffiliateNoteLink className={`self-center${above}`} />
    </div>
  );
}
