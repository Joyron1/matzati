import type { NextRequest } from "next/server";
import { clickOut } from "@/lib/search/server";

// Click-out (CLAUDE.md §7): logs { product_id, src, created_at } and redirects to the affiliate
// link. Every buy button goes through here.

// A route handler cannot render app/not-found.tsx, so the 404 is a minimal standalone page.
const NOT_FOUND_HTML = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>המוצר לא נמצא</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; text-align: center; line-height: 1.6">
<h1>לא מצאנו את המוצר הזה</h1>
<p>ייתכן שהקישור ישן או שהמוצר כבר לא זמין באלי אקספרס.</p>
<p><a href="/" style="display: inline-block; padding: 0.75rem 1.5rem">לחיפוש חדש</a></p>
</body>
</html>
`;

export async function GET(request: NextRequest, ctx: RouteContext<"/go/[productId]">) {
  const { productId } = await ctx.params;
  const link = await clickOut(productId, request.nextUrl.searchParams.get("src") ?? "");
  if (!link) {
    return new Response(NOT_FOUND_HTML, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: link, "Cache-Control": "no-store" },
  });
}

// Link checkers and previews send HEAD; answer without logging a click or resolving a link.
export async function HEAD() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
