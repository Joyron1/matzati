// A photo for every category tile of /products (owner request 2026-10-27: tiles showed an icon when
// the server did not hold that category's list). The fallback is the best-selling product of that
// category we stored in the last 30 days (`products`, the hot lists' and searches' rows): one small
// query per category, all cached 12 hours under the hot lists' tag. Never an AliExpress call; a
// failed read is just no photo (the icon stays).
import "server-only";
import { unstable_cache } from "next/cache";
import { isAllowedImage } from "@/lib/images";
import { serviceClient } from "@/lib/supabase/server";
import { CATALOG, type CatalogCategory } from "./categories";

const RECENT_DAYS = 30;

async function bestPhoto(c: CatalogCategory, since: string): Promise<string | null> {
  const field = c.slice ? "data->category->>secondId" : "data->category->>firstId";
  const id = c.slice ? c.slice.subcategoryId : c.firstLevelId;
  const { data, error } = await serviceClient()
    .from("products")
    .select("image:data->>mainImageUrl")
    .eq(field, id)
    .eq("data->>currency", "ILS")
    .gte("updated_at", since)
    .order("data->unitsSold", { ascending: false, nullsFirst: false })
    .limit(3);
  if (error) return null;
  const rows = (data ?? []) as { image: string | null }[];
  return rows.map((r) => r.image).find((u): u is string => !!u && isAllowedImage(u)) ?? null;
}

/** The fallback photo per category key (absent when none was found). */
export const categoryPhotosFromDb = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60_000).toISOString();
    const entries = await Promise.all(
      CATALOG.map(async (c) => [c.key, await bestPhoto(c, since).catch(() => null)] as const),
    );
    return Object.fromEntries(entries.filter((e): e is [string, string] => e[1] !== null));
  },
  ["catalog-tile-photos", "1"],
  { revalidate: 12 * 60 * 60, tags: ["hot-products"] },
);
