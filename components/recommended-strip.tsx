// "המומלצים שלנו" on the home page (owner request 2026-10-19): the newest products the owner
// approved from the product finder's queue (lib/agents/server.ts), with a link to /recommended.
// Server component; renders nothing while there are none.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { recommendedProducts } from "@/lib/agents/server";
import { StandardProductCard } from "./product-cards";

/** Cards on the home page: one row of five from xl. */
export const HOME_RECOMMENDED = 5;

export async function RecommendedStrip() {
  const products = (await recommendedProducts()).slice(0, HOME_RECOMMENDED);
  if (!products.length) return null;
  return (
    <section
      aria-labelledby="recommended-title"
      className="mx-auto mt-12 max-w-6xl space-y-4 px-4 sm:mt-16 sm:px-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h2 id="recommended-title" className="font-display text-3xl">
            המומלצים שלנו
          </h2>
          <p className="text-sm text-muted">
            מוצרים שבחרנו מתוך מה שעבר את הסינון.{" "}
            <Link href="/recommended#about" className="underline underline-offset-4 hover:text-ink">
              איך בחרנו
            </Link>
          </p>
        </div>
        <Link
          href="/recommended"
          className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-ink hover:underline"
        >
          לכל המומלצים
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {products.map((p, i) => (
          <li key={p.product_id}>
            <StandardProductCard
              product={p}
              rank={i + 1}
              q=""
              src="home_recommended"
              rankOf={null}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
