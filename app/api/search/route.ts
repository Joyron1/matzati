// POST /api/search (CLAUDE.md §6). Errors are codes; the UI turns them into Hebrew messages.
import { z } from "zod";
import { absoluteUrl } from "@/lib/config/site";
import { isBotUserAgent } from "@/lib/guard/bots";
import { HOT_PATH } from "@/lib/hot/params";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import { cachedSearchForBot, searchForRequest, type SearchFailure } from "@/lib/search/server";

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

/**
 * A crawler or script (lib/guard/bots.ts) never starts paid work: the cached results when this
 * exact search is cached, otherwise 200 with `error: "bots_only"`, a short note and the pages it
 * may read instead. Never indexed.
 */
async function botResponse(input: z.infer<typeof bodySchema>, headers: Headers) {
  const noindex = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const cached = await cachedSearchForBot(input, headers);
  if (cached) return Response.json(cached, { headers: noindex });
  return Response.json(
    {
      error: "bots_only",
      message:
        "The live search runs for visitors only. Read the home page, the hot products and the published search pages instead.",
      links: [absoluteUrl("/"), absoluteUrl(HOT_PATH), absoluteUrl("/llms.txt")],
    },
    { headers: noindex },
  );
}

export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) {
    const badQuery = body.error.issues.some((i) => i.path[0] === "q");
    return errorResponse(badQuery ? "invalid_query" : "invalid_request", 400);
  }
  if (isBotUserAgent(request.headers.get("user-agent"))) {
    return botResponse(body.data, request.headers);
  }
  const result = await searchForRequest(body.data, request.headers);
  if (!result.ok) return errorResponse(result.error, STATUS[result.error], result.retryAfterSec);
  return Response.json(result.response, { headers: { "Cache-Control": "no-store" } });
}
