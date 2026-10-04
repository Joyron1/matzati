// The answer of /go once the click is logged and the affiliate link resolved (./route.ts): a 302
// to AliExpress, exactly as before the Meta Pixel, unless a pixel id is set AND the request's
// consent cookie grants marketing under the current notice. Then a tiny page sends the buy-click
// event (InitiateCheckout with the product id only) and moves on to AliExpress.
//
// Why here and not on the buy button: the buttons sit on /search?q=… and /p/…?q=… pages, and
// fbevents.js always sends the page address, so an event sent from there would carry the search
// text. /go's own address holds only src, s (a random search uid) and pos (goHref in
// lib/search-url.ts), never visitor text, and the page empties document.referrer before the pixel
// loads and sends no Referer (no-referrer).
import { buyClickScript } from "@/components/analytics/fbq";
import { affiliateUrl } from "@/lib/aliexpress/schemas";
import { consentAllows, consentFromCookies, consentNotice } from "@/lib/consent/consent";

/** The owner settings /go needs (publicSettings). */
export interface GoSettings {
  measurementId: string | null;
  metaPixelId: string | null;
}

/** The buy-click page's longest wait for the event before moving on. */
export const BUY_CLICK_MAX_WAIT_MS = 800;

/**
 * Whether the buy-click event may be sent: a pixel id is set and the visitor's stored choice,
 * under the notice the site shows now (Google Analytics and Meta Pixel as configured), grants
 * marketing. `cookieHeader` is the request's Cookie header.
 */
export function buyClickEventAllowed(
  settings: GoSettings,
  cookieHeader: string | null,
  now: number = Date.now(),
): boolean {
  if (!settings.metaPixelId) return false;
  const notice = consentNotice(settings.measurementId !== null, true);
  return consentAllows(consentFromCookies(cookieHeader ?? "", now, notice), "marketing");
}

/** Text for an HTML attribute or element. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The buy-click page: the event, then AliExpress (a link and a meta refresh as fallbacks). */
export function buyClickHtml({
  pixelId,
  productId,
  link,
}: {
  pixelId: string;
  productId: string;
  link: string;
}): string {
  const href = escapeHtml(link);
  const script = buyClickScript({
    pixelId,
    productId,
    affiliateUrl: link,
    maxWaitMs: BUY_CLICK_MAX_WAIT_MS,
  });
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="2;url=${href}">
<title>מעבירים אתכם לאלי אקספרס…</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; text-align: center; line-height: 1.6">
<p role="status">מעבירים אתכם לאלי אקספרס…</p>
<p><a href="${href}" rel="sponsored nofollow" style="display: inline-block; padding: 0.75rem 1.5rem">להמשך לאלי אקספרס</a></p>
<script>${script}</script>
</body>
</html>
`;
}

/**
 * The response for a resolved click: the buy-click page when buyClickEventAllowed, else the 302
 * of before. `link` is already an https AliExpress URL (clickOut); the page is built only after
 * the same check again, so nothing else is ever written into it.
 */
export function goResponse({
  link,
  productId,
  settings,
  cookieHeader,
  now = Date.now(),
}: {
  link: string;
  productId: string;
  settings: GoSettings;
  cookieHeader: string | null;
  now?: number;
}): Response {
  const safe = affiliateUrl(link);
  if (safe && settings.metaPixelId && buyClickEventAllowed(settings, cookieHeader, now)) {
    return new Response(buyClickHtml({ pixelId: settings.metaPixelId, productId, link: safe }), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: link, "Cache-Control": "no-store" },
  });
}
