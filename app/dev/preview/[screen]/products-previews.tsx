// /dev/preview/products-category: a /products category page (app/products/[slug]/category-view.tsx)
// with a made-up list of 3 loaded pages, so its pills, filters, "הצגת עוד מוצרים", breadcrumbs and
// the header's categories menu can be looked at without a hot list fetch. Params as on the real
// page (?sub=, ?price=, ?page=, ?lists=), plus ?state=failed or ?state=empty.
import type { ReactNode } from "react";
import { CategoryView } from "@/app/products/[slug]/category-view";
import { catalogBySlug } from "@/lib/catalog/categories";
import type { CategoryListResult } from "@/lib/catalog/load";
import { mergeCategoryPages } from "@/lib/catalog/list";
import { parseCategoryParams } from "@/lib/catalog/params";
import { firstParam } from "@/lib/search-url";
import type { HotProduct } from "@/lib/hot/select";

const IMG = (name: string) => `https://ae-pic-a1.aliexpress-media.com/kf/${name}`;
const IMAGES = [
  "S77915714249b42d583972e4076b2b04dZ.jpg",
  "S208e59066ea64143963230db82f0e2148.jpg",
  "S2e87e57a7fc944399088a820931f12bbc.jpg",
  "S7b9e52a1027f4e21bf9eb89a4338ee35y.jpg",
  "S5d6b30ff6d9b4ec2869eeab07895e0d3e.jpg",
  "Sfecc881ce40e473aa689cf8947a36634V.jpg",
];
// Jewelry's second-level ids (lib/catalog/subcategories.ts), and one we have no name for ("עוד").
const SUBS = ["1509", "1509", "200001680", "201239108", "1509", "200370154", "999999"];
const NAMES = ["שרשרת", "עגילים", "צמיד", "טבעת", "תליון", "סט תכשיטים"];

function fakePage(page: number, count: number, now: Date): HotProduct[] {
  return Array.from({ length: count }, (_, i) => {
    const n = page * 100 + i;
    const price = 9 + ((n * 37) % 240);
    const original = n % 3 === 0 ? null : Math.round(price * 1.6);
    return {
      productId: `20000000000${String(n).padStart(4, "0")}`,
      title: `${NAMES[n % NAMES.length]} לדוגמה מספר ${n} מכסף בציפוי זהב (נתונים מומצאים)`,
      imageUrl: IMG(IMAGES[n % IMAGES.length]),
      price,
      originalPrice: original,
      discountPct: original ? Math.round((1 - price / original) * 100) : null,
      positiveFeedbackPct: 90 + (n % 10),
      unitsSold: 5000 - page * 1500 - i * 30,
      hasVideo: n % 5 === 0,
      promoCode:
        n % 7 === 0
          ? {
              code: `DEMO${n}`,
              offerText: "On order over ILS 62.2 , get ILS 3.11 off",
              offer: null,
              minSpend: null,
              startsAt: new Date(now.getTime() - 86_400_000).toISOString(),
              endsAt: new Date(now.getTime() + 86_400_000).toISOString(),
              promotionUrl: null,
            }
          : null,
      categoryId: "36",
      subcategoryId: SUBS[n % SUBS.length],
      shopId: `shop-${n % 23}`,
    };
  });
}

export function CategoryPreview({
  params,
  now,
  note,
}: {
  params: Record<string, string | string[] | undefined>;
  now: Date;
  note: (text: string) => ReactNode;
}) {
  const category = catalogBySlug("תכשיטים")!;
  const filter = parseCategoryParams(category, params);
  const state = firstParam(params.state);
  const fetchedAt = new Date(now.getTime() - 3 * 3_600_000).toISOString();
  const pages = [42, 44, 41]
    .slice(0, filter.lists)
    .map((count, i) => ({ products: fakePage(i, count, now), checked: 47, fetchedAt }));
  const list = mergeCategoryPages(category, pages)!;
  const result: CategoryListResult =
    state === "failed" || state === "empty"
      ? { ok: false, reason: state }
      : { ok: true, list, loaded: pages.length, complete: true };
  return (
    <>
      {note("כמו עמוד קטגוריה של כל המוצרים, עם 3 חלקים של רשימה מומצאת.")}
      <CategoryView
        category={category}
        filter={filter}
        result={result}
        now={now}
        origin="https://www.matzati-il.com"
      />
    </>
  );
}
