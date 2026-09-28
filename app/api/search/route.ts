// POST /api/search (CLAUDE.md §6). Errors are codes; the UI turns them into Hebrew messages.
import { z } from "zod";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import { searchForRequest, type SearchFailure } from "@/lib/search/server";

// Parse + up to 3 spaced AliExpress calls + link.generate + explain, with SDK retries.
export const maxDuration = 60;

const bodySchema = z.object({
  q: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  without: z.array(z.string().max(120)).max(10).optional(),
  sort: z.enum(["best_value", "cheapest", "most_popular"]).optional(),
});

const STATUS: Record<SearchFailure, number> = {
  invalid_query: 400,
  parse_failed: 400,
  rate_limited: 429,
  capacity: 503,
  upstream: 503,
  llm: 503,
  unavailable: 503,
};

function errorResponse(error: string, status: number, retryAfterSec?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSec !== undefined) headers["Retry-After"] = String(retryAfterSec);
  return Response.json(retryAfterSec === undefined ? { error } : { error, retryAfterSec }, {
    status,
    headers,
  });
}

export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) {
    const badQuery = body.error.issues.some((i) => i.path[0] === "q");
    return errorResponse(badQuery ? "invalid_query" : "invalid_request", 400);
  }
  const result = await searchForRequest(body.data, request.headers);
  if (!result.ok) return errorResponse(result.error, STATUS[result.error], result.retryAfterSec);
  return Response.json(result.response, { headers: { "Cache-Control": "no-store" } });
}
