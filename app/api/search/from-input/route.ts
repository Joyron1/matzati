// POST /api/search/from-input (owner request 2026-10-23): search by image or by a product link.
// - multipart form with `image` (JPEG, PNG or WebP, up to 8 MB): resized to a JPEG of at most
//   1024 px (sharp), described by the site's LLM (vision); the photo is never stored.
// - JSON {"link": "https://..."}: an AliExpress item opens our product page (saved first with
//   productdetail.get, so /p and /go work); another store's page is read for its product name
//   (lib/search/from-input.ts) and the LLM makes it a short Hebrew query.
// Answers {q} (the page then opens /search?q=…) or {productId}. Visitors only (a crawler gets
// 403), counted against the per-IP search limit, and an LLM call only within the daily budget.
import sharp from "sharp";
import { z } from "zod";
import { getProductDetails } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { aliexpressConfig, ConfigError, llmConfig } from "@/lib/env";
import { isBotUserAgent } from "@/lib/guard/bots";
import { checkSearchRate, clientIp, consumeDailyLlmBudget, hashIp } from "@/lib/guard/rate-limit";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import {
  aliexpressItemId,
  fetchableUrl,
  fetchPage,
  isAliexpressShortLink,
  productFromHtml,
  queryFromImage,
  queryFromProductName,
  wordsFromUrl,
  type QueryOutcome,
} from "@/lib/search/from-input";
import { guardEnv } from "@/lib/search/server";
import { SupabaseStore } from "@/lib/search/supabase-store";
import { serviceClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const noStore = { "Cache-Control": "no-store" };

type Fail = "invalid" | "rate_limited" | "capacity" | "not_found" | "unreadable" | "unavailable";

function fail(error: Fail, status: number, retryAfterSec?: number): Response {
  const headers: Record<string, string> = { ...noStore };
  if (retryAfterSec) headers["Retry-After"] = String(retryAfterSec);
  return Response.json({ error, ...(retryAfterSec ? { retryAfterSec } : {}) }, { status, headers });
}

function llm() {
  const cfg = llmConfig();
  if (cfg.provider !== "anthropic" || !cfg.apiKey) throw new ConfigError(["ANTHROPIC_API_KEY"]);
  return new AnthropicProvider(cfg.apiKey, cfg.model);
}

/** Records the LLM call (llm_usage, kind "parse": it understands the search). */
async function logUsage(store: SupabaseStore, out: QueryOutcome) {
  if (out.usage && out.model) {
    await store.logUsage([{ kind: "parse", model: out.model, usage: out.usage }]).catch(() => {});
  }
}

/** An AliExpress item: saved with productdetail.get (so /p and /go work), then its page. */
async function aliexpressProduct(store: SupabaseStore, productId: string): Promise<Response> {
  try {
    const page = await getProductDetails(
      new AliExpressClient(aliexpressConfig()),
      [productId],
      "HE",
    );
    const product = page.products[0];
    if (!product?.promotionLink) return fail("not_found", 404);
    await store.saveProducts([{ ...product, source: "hot" }], {}, new Date(), {
      keepTitledRows: true,
    });
    return Response.json({ productId }, { headers: noStore });
  } catch {
    return fail("not_found", 404);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (isBotUserAgent(request.headers.get("user-agent"))) return fail("invalid", 403);
  const env = guardEnv();
  if (!env.ipHashSalt) return fail("unavailable", 503);
  const db = serviceClient();
  const rate = await checkSearchRate(
    db,
    hashIp(clientIp(request.headers), env.ipHashSalt),
    new Date(),
  );
  if (!rate.ok) return fail("rate_limited", 429, rate.retryAfterSec);
  const store = new SupabaseStore(db);
  const contentType = request.headers.get("content-type") ?? "";

  try {
    // --- A link ---------------------------------------------------------------------------------
    if (contentType.includes("application/json")) {
      const body = z
        .object({ link: z.string().min(8).max(2000) })
        .safeParse(await request.json().catch(() => null));
      const start = body.success ? fetchableUrl(body.data.link) : null;
      if (!start) return fail("invalid", 400);

      const direct = aliexpressItemId(start);
      if (direct) return aliexpressProduct(store, direct);
      const page = await fetchPage(start);
      // A short AliExpress link resolves to its item.
      const resolved = page ? aliexpressItemId(page.url) : null;
      if (resolved) return aliexpressProduct(store, resolved);
      if (isAliexpressShortLink(start)) return fail("unreadable", 422);

      const found = page?.html ? productFromHtml(page.html) : { name: null, brand: null };
      const name = found.name ?? wordsFromUrl(page?.url ?? start);
      if (!name) return fail("unreadable", 422);
      if (!(await consumeDailyLlmBudget(db, new Date(), env.dailyCap)))
        return fail("capacity", 503);
      const out = await queryFromProductName(llm(), name, found.brand);
      await logUsage(store, out);
      return out.query
        ? Response.json({ q: out.query }, { headers: noStore })
        : fail("unreadable", 422);
    }

    // --- An image -------------------------------------------------------------------------------
    const form = await request.formData().catch(() => null);
    const file = form?.get("image");
    if (
      !(file instanceof File) ||
      !IMAGE_TYPES.includes(file.type) ||
      file.size > MAX_IMAGE_BYTES
    ) {
      return fail("invalid", 400);
    }
    const jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (!(await consumeDailyLlmBudget(db, new Date(), env.dailyCap))) return fail("capacity", 503);
    const out = await queryFromImage(llm(), jpeg);
    await logUsage(store, out);
    return out.query
      ? Response.json({ q: out.query }, { headers: noStore })
      : fail("not_found", 422);
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[search-from-input] ${text.slice(0, 300)}`);
    return fail("unavailable", 503);
  }
}
