import { Share2 } from "lucide-react";
import { absoluteUrl } from "@/lib/config/site";
import { whatsappShareUrl } from "@/lib/format";

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
}: {
  text: string;
  /** The shared page, e.g. "/p/1005001" or a searchHref(...). */
  path: string;
  label?: string;
}) {
  return (
    <a
      href={whatsappShareUrl(text, absoluteUrl(path))}
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
