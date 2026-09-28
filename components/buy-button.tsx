import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { AFFILIATE_NOTE, BUY_LABEL } from "@/lib/copy";
import { goHref } from "@/lib/search-url";
import { btnLg, btnMd, btnPrimary } from "./styles";

interface BuyButtonProps {
  productId: string;
  /** Where the click came from, logged by /go. */
  src: string;
  /** On a result card: the uid of the search_log row that showed it, logged by /go. */
  searchUid?: string;
  /** On a result card: its 1-based rank, logged by /go. */
  position?: number;
  size?: "lg" | "md";
  className?: string;
}

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
  className = "",
}: BuyButtonProps) {
  return (
    <div className={`flex flex-col ${className}`}>
      <a
        href={goHref(productId, src, { searchUid, position })}
        target="_blank"
        rel="sponsored nofollow noopener"
        className={`${btnPrimary} ${size === "lg" ? btnLg : btnMd} w-full`}
      >
        {BUY_LABEL}
        <ExternalLink aria-hidden className="size-[18px]" />
        <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
      </a>
      <AffiliateNoteLink className="self-center" />
    </div>
  );
}
