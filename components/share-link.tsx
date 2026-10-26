// "שיתוף בוואטסאפ": shares our page (never the affiliate link) through wa.me. A text link by
// default; `variant="button"` (owner request 2026-10-27, the product page) is a solid WhatsApp-green
// button with white text and WhatsApp's mark. WhatsApp's teal green (#128C7E), not the bright
// #25D366: white text on that one is 2:1, on this about 4.1:1, enough for bold text.
import { Share2 } from "lucide-react";
import { absoluteUrl } from "@/lib/config/site";
import { whatsappShareUrl } from "@/lib/format";

/** WhatsApp's mark (a speech bubble with a handset), one color. */
function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12.04 2C6.58 2 2.15 6.43 2.15 11.89c0 1.75.46 3.45 1.33 4.95L2 22l5.3-1.39a9.86 9.86 0 0 0 4.74 1.21h.01c5.46 0 9.89-4.43 9.89-9.89A9.83 9.83 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.14.83.84-3.06-.2-.31a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.25-8.23a8.22 8.22 0 0 1 8.23 8.24c0 4.54-3.69 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.38-1.99-1.22-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.42h-.48a.92.92 0 0 0-.66.31c-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.25 3.75.59.26 1.05.41 1.41.52.6.19 1.14.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.1-.22-.17-.47-.29Z" />
    </svg>
  );
}

/**
 * Shares a page of our site on WhatsApp (never the affiliate link). The page is named by its path,
 * never read from the browser's address: after a client navigation the new page renders before the
 * address changes, so a product page reached from /search shared the search, whose preview is the
 * brand card (owner report 2026-10-21). /p/<id> previews with the product's own card.
 */
export function ShareLink({
  text,
  path,
  label = "שיתוף בוואטסאפ",
  variant = "link",
}: {
  text: string;
  /** The shared page, e.g. "/p/1005001" or a searchHref(...). */
  path: string;
  label?: string;
  variant?: "link" | "button";
}) {
  const href = whatsappShareUrl(text, absoluteUrl(path));
  if (variant === "button") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-[#128C7E] px-4 text-[15px] font-bold whitespace-nowrap text-white transition-transform hover:bg-[#0E7468] active:scale-[0.98] motion-reduce:transition-none"
      >
        <WhatsAppMark className="size-5" />
        {label}
        <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
    >
      <Share2 aria-hidden className="size-[18px]" />
      {label}
      <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
    </a>
  );
}
