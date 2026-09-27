// POST /api/search/more: "עוד 3 אפשרויות" for a cached result set (explains the page on demand).
import { z } from "zod";
import { moreForRequest } from "@/lib/search/server";

// One explain call, with SDK retries.
export const maxDuration = 60;

const bodySchema = z.object({
  filters_key: z.string().regex(/^[0-9a-f]{64}$/),
  page: z.number().int().min(1).max(50),
});

const STATUS = { not_found: 404, capacity: 503, rate_limited: 429, unavailable: 503 } as const;

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
  if (!body.success) return errorResponse("invalid_request", 400);
  const result = await moreForRequest(body.data.filters_key, body.data.page, request.headers);
  if (!result.ok) return errorResponse(result.error, STATUS[result.error], result.retryAfterSec);
  return Response.json(
    { results: result.results, more_available: result.more_available },
    { headers: { "Cache-Control": "no-store" } },
  );
}
