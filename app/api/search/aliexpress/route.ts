// POST /api/search/aliexpress: "עוד מוצרים שמצאנו באלי אקספרס" under a smart search's results
// (owner request 2026-10-19): the simple search of the same query, without the products the smart
// result set holds. Never an LLM call (moreFromAliExpressForRequest in lib/search/server.ts).
import { z } from "zod";
import { parseSearchCategory } from "@/lib/search-url";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import { moreFromAliExpressForRequest } from "@/lib/search/server";

// One product.query and perhaps one link.generate, spaced.
export const maxDuration = 30;

const bodySchema = z.object({
  q: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  cat: z.string().max(20).optional(),
  exclude: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success)
    return Response.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  const result = await moreFromAliExpressForRequest(
    {
      q: body.data.q,
      category: parseSearchCategory(body.data.cat),
      exclude: body.data.exclude,
    },
    request.headers,
  );
  if (!result.ok) {
    const headers: Record<string, string> =
      result.error === "rate_limited"
        ? { ...noStore, "Retry-After": String(result.retryAfterSec) }
        : noStore;
    return Response.json(
      { error: result.error },
      { status: result.error === "rate_limited" ? 429 : 503, headers },
    );
  }
  return Response.json({ results: result.results, ranks: result.ranks }, { headers: noStore });
}
