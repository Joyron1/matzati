import { ExternalLink } from "lucide-react";
import { AFFILIATE_DISCLOSURE, BUY_LABEL } from "@/lib/copy";
import { btnLg, btnMd, btnPrimary } from "./styles";

interface BuyButtonProps {
  productId: string;
  /** Where the click came from, logged by /go. */
  src: string;
  size?: "lg" | "md";
  className?: string;
}

/** Every buy button goes through /go and carries the affiliate disclosure right under it. */
export function BuyButton({ productId, src, size = "lg", className = "" }: BuyButtonProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <a
        href={`/go/${encodeURIComponent(productId)}?src=${encodeURIComponent(src)}`}
        target="_blank"
        rel="sponsored nofollow noopener"
        className={`${btnPrimary} ${size === "lg" ? btnLg : btnMd} w-full`}
      >
        {BUY_LABEL}
        <ExternalLink aria-hidden className="size-[18px]" />
        <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
      </a>
      <p className="text-xs leading-relaxed text-muted">{AFFILIATE_DISCLOSURE}</p>
    </div>
  );
}
