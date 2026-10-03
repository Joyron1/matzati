// /hot was the hot products page until 2026-10-03; "כל המוצרים" (/products) replaced it. Old links,
// bookmarks and indexed pages get a permanent redirect (308) to the same list: /hot?cat=<id> to
// that category's page, anything else to /products, with the filters that mean the same there
// (hotRedirectHref, tested in lib/hot/params.test.ts). No list is loaded here.
import type { NextRequest } from "next/server";
import { hotRedirectHref } from "@/lib/hot/params";

export function GET(request: NextRequest): Response {
  const params: Record<string, string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    params[key] = request.nextUrl.searchParams.getAll(key);
  }
  return Response.redirect(new URL(hotRedirectHref(params), request.nextUrl.origin), 308);
}
