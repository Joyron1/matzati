// GET /api/similar: /p's similar products (owner request 2026-10-08: /p is cached for a day, so the
// parts that depend on where the visitor came from, the back link and this list, are read in the
// browser). The query is the product page's own (q, from, cat, sort, without) plus the product
// (`id`) and its first-level category (`category`). Reads only, like the section was
// (lib/similar/load.ts): never an LLM call, an AliExpress call or a database write. Answers
// `{data: null}` when there is nothing to show. Cached at the edge for an hour per URL.
import { hotBack } from "@/lib/hot/params";
import { firstParam, parseSort, parseWithout } from "@/lib/search-url";
import { similarForPage } from "@/lib/similar/load";

const PRODUCT_ID = /^\d{1,20}$/;
const CATEGORY_ID = /^\d{1,12}$/;

const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const productId = params.get("id") ?? "";
  if (!PRODUCT_ID.test(productId)) {
    return Response.json({ data: null }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const record = (key: string) => params.getAll(key);
  const query = Object.fromEntries(
    ["q", "from", "cat", "sort", "without"].map((key) => [key, record(key)]),
  );
  const category = params.get("category") ?? "";
  const back = hotBack(query);
  const data = await similarForPage({
    productId,
    categoryId: CATEGORY_ID.test(category) ? category : null,
    q: firstParam(query.q).trim().slice(0, 200),
    sort: parseSort(query.sort),
    without: parseWithout(query.without),
    hot: back ? { category: back.category } : null,
  });
  return Response.json({ data }, { headers: { "Cache-Control": CACHE } });
}
