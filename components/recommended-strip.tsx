// "המומלצים שלנו" on the home page (owner request 2026-10-19): products the owner approved from the
// product finder's queue (lib/agents/server.ts). Since 2026-11-01 (owner request) a carousel above
// the hot products, like theirs (HotProductsScroller: swipe, buttons, auto-advance, pause), in a
// random order on every visit (ShuffledItems: the home page is cached an hour, so the browser
// shuffles), with "לכל המומלצים" beside the heading and as the row's last tile.
// Server component; renders nothing while there are none.
import Link from "next/link";
import { ChevronLeft, Star } from "lucide-react";
import { recommendedProducts } from "@/lib/agents/server";
import { HOT_ITEM, HOT_SECTION } from "./hot-carousel-layout";
import { HotProductsScroller } from "./hot-products-scroller";
import { StandardProductCard } from "./product-cards";
import { ShuffledItems } from "./shuffled-items";
import { card } from "./styles";

/** Cards rendered in the row (the browser shuffles these). */
export const HOME_RECOMMENDED = 24;

const TITLE = "המומלצים שלנו";

function Heading() {
  return (
    <div className="space-y-1">
      <h2 id="recommended-title" className="flex items-center gap-2 font-display text-3xl text-ink">
        <Star aria-hidden className="size-7 shrink-0 text-accent-ink" />
        {TITLE}
      </h2>
      <p className="text-sm text-muted">
        מוצרים שבחרנו מתוך מה שעבר את הסינון.{" "}
        <Link href="/recommended#about" className="underline underline-offset-4 hover:text-ink">
          איך בחרנו
        </Link>
        {" · "}
        <Link
          href="/recommended"
          className="font-semibold whitespace-nowrap text-accent-ink underline-offset-4 hover:underline"
        >
          לכל המומלצים
        </Link>
      </p>
    </div>
  );
}

export async function RecommendedStrip() {
  const products = (await recommendedProducts()).slice(0, HOME_RECOMMENDED);
  if (!products.length) return null;
  return (
    <section aria-labelledby="recommended-title" className={HOT_SECTION}>
      <HotProductsScroller label={TITLE} heading={<Heading />}>
        <ShuffledItems
          trailing={
            <li className={HOT_ITEM}>
              <Link
                href="/recommended"
                className={`${card} flex h-full min-h-64 flex-col items-center justify-center gap-2 p-4 text-center font-semibold text-accent-ink hover:border-accent`}
              >
                <Star aria-hidden className="size-8" />
                לכל המומלצים
                <ChevronLeft aria-hidden className="size-5" />
              </Link>
            </li>
          }
        >
          {products.map((p, i) => (
            <li key={p.product_id} className={HOT_ITEM}>
              <StandardProductCard
                product={p}
                rank={i + 1}
                q=""
                src="home_recommended"
                rankOf={null}
              />
            </li>
          ))}
        </ShuffledItems>
      </HotProductsScroller>
    </section>
  );
}
