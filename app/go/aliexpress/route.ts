import type { NextRequest } from "next/server";
import { isBotUserAgent } from "@/lib/guard/bots";
import { clickOutHome } from "@/lib/search/server";

// Click-out to AliExpress's home page through our affiliate link (owner request 2026-11-01): the
// sitewide coupons on /coupons link here, `src=coupons`. Like /go/<id> (CLAUDE.md §7): a crawler
// never reaches the affiliate link, the click is logged (product_id "aliexpress_home"), and the
// answer is a 302. A static segment, so it wins over /go/[productId].

export const maxDuration = 30;

const BOT_HTML = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>מעבר לאלי אקספרס</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; text-align: center; line-height: 1.6">
<h1>הקישור לאלי אקספרס פתוח לגולשים בדפדפן</h1>
<p><a href="/coupons">לעמוד הקופונים</a></p>
</body>
</html>
`;

export async function GET(request: NextRequest) {
  if (isBotUserAgent(request.headers.get("user-agent"))) {
    return new Response(BOT_HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }
  const link = await clickOutHome(request.nextUrl.searchParams.get("src") ?? "");
  return new Response(null, {
    status: 302,
    headers: { Location: link, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

// Link checkers and previews send HEAD; answer without logging a click or resolving a link.
export async function HEAD() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
