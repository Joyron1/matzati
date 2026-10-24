// The products of a shared list (/shared?ids=…), read from our products table (the rows a search, a
// hot list or a product page saved). Server-only; never calls AliExpress: a product we have no row
// for is left out.
import "server-only";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { hotTitle } from "@/lib/product-title";
import { toResultProduct } from "@/lib/search/pipeline";
import { serviceClient } from "@/lib/supabase/server";
import type { ResultProduct } from "@/lib/types";

export async function loadSharedProducts(ids: readonly string[]): Promise<ResultProduct[]> {
  if (!ids.length) return [];
  const { data, error } = await serviceClient()
    .from("products")
    .select("product_id, data, title_he")
    .in("product_id", [...ids]);
  if (error) throw new Error(`shared list: ${error.message}`);
  const byId = new Map(
    (data ?? []).map((row) => [
      String(row.product_id),
      row as { data: unknown; title_he: unknown },
    ]),
  );
  return ids.flatMap((id) => {
    const row = byId.get(id);
    const p = row?.data as AliProduct | undefined;
    if (!p || typeof p.title !== "string" || !Array.isArray(p.imageUrls)) return [];
    const title =
      typeof row?.title_he === "string" && row.title_he ? row.title_he : hotTitle(p.title);
    return [toResultProduct(p, { title_he: title, why_he: "" })];
  });
}
