import type { Metadata } from "next";
import Link from "next/link";
import { Heart, Search } from "lucide-react";
import { StandardProductCard } from "@/components/product-cards";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { parseSharedIds } from "@/lib/saved/shared";
import { loadSharedProducts } from "@/lib/saved/shared-server";
import { pageMetadata } from "@/lib/seo/page-meta";
import type { ResultProduct } from "@/lib/types";

// A saved list someone shared on WhatsApp (owner request 2026-10-24): /shared?ids=1,2,3, the
// products read from our own rows (lib/saved/shared-server.ts). The link says nothing about who
// shared it. Each card has its heart, so the friend can save what they like to their own list.
export const metadata: Metadata = {
  ...pageMetadata({
    title: "רשימת מוצרים ששיתפו איתכם",
    description: `מוצרים מאלי אקספרס ששמרו ב־${BRAND.name} ושיתפו איתכם.`,
    path: "/shared",
  }),
  // A list made of whatever ids a link carries: nothing for search engines.
  robots: { index: false, follow: true },
};

export default async function SharedPage({ searchParams }: PageProps<"/shared">) {
  const ids = parseSharedIds((await searchParams).ids);
  let products: ResultProduct[] = [];
  let failed = false;
  try {
    products = await loadSharedProducts(ids);
  } catch (err) {
    console.error(`[shared] ${String(err).slice(0, 200)}`);
    failed = true;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <h1 className="font-display text-3xl sm:text-4xl">רשימת מוצרים ששיתפו איתכם</h1>
        <p className="max-w-2xl text-muted">
          מישהו שמר את המוצרים האלה ב{BRAND.name} ושלח לכם את הרשימה. אהבתם משהו? לחצו על הלב כדי
          לשמור אותו גם אצלכם.
        </p>
      </header>
      {products.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {products.map((p, i) => (
            <li key={p.product_id}>
              <StandardProductCard product={p} rank={i + 1} q="" src="shared" rankOf={null} />
            </li>
          ))}
        </ul>
      ) : (
        <div className={`${card} flex flex-col items-center gap-4 p-8 text-center`}>
          <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <Heart aria-hidden className="size-7" />
          </span>
          <p className="text-lg font-bold">
            {failed ? "לא הצלחנו לטעון את הרשימה כרגע" : "לא מצאנו מוצרים ברשימה הזאת"}
          </p>
          <p className="max-w-md text-muted">
            {failed ? "נסו שוב בעוד רגע." : "ייתכן שהקישור נקטע בדרך. בקשו מהשולח לשלוח אותו שוב."}
          </p>
          <Link href="/" className={`${btnPrimary} ${btnMd} gap-2`}>
            <Search aria-hidden className="size-[18px]" />
            לחיפוש מוצרים
          </Link>
        </div>
      )}
    </div>
  );
}
