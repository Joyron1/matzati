// One-off probe (2026-10-23, category assignment): how product.query behaves with category_ids.
// 4 requests, 1.5 s apart, no retries: "remote control car" without a category and with Toys &
// Hobbies (26); "moissanite necklace" with Jewelry & Accessories (36); "remote control car" with two
// ids "26,34" (does a comma list work?). Prints counts, first-level categories and a few titles.
// Usage: npx tsx --env-file=.env.local scripts/probe-category.ts
import { queryProducts } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { aliexpressConfig } from "@/lib/env";

const CALLS: { keywords: string; categoryIds?: string }[] = [
  { keywords: "remote control car" },
  { keywords: "remote control car", categoryIds: "26" },
  { keywords: "moissanite necklace", categoryIds: "36" },
  { keywords: "remote control car", categoryIds: "26,34" },
];

async function main() {
  const client = new AliExpressClient(aliexpressConfig(), { retries: 0 });
  for (const [i, c] of CALLS.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1_500));
    console.log(`\n--- ${c.keywords} | category_ids=${c.categoryIds ?? "-"}`);
    try {
      const page = await queryProducts(client, {
        keywords: c.keywords,
        pageNo: 1,
        sort: "LAST_VOLUME_DESC",
        ...(c.categoryIds ? { categoryIds: c.categoryIds } : {}),
      });
      const byCat = new Map<string, number>();
      for (const p of page.products) {
        const k = `${p.category.firstId}:${p.category.firstName ?? ""}`;
        byCat.set(k, (byCat.get(k) ?? 0) + 1);
      }
      console.log(`products ${page.products.length}, total ${page.totalRecords}`);
      console.log(`first-level: ${[...byCat].map(([k, n]) => `${k} x${n}`).join(" | ")}`);
      for (const p of page.products.slice(0, 6)) console.log(`  ${p.title.slice(0, 90)}`);
    } catch (err) {
      console.log(`error: ${String(err).slice(0, 300)}`);
    }
  }
}

void main();
