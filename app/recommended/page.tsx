// "המומלצים שלנו" (owner request 2026-10-19): the products the owner approved from the product
// finder's queue (/admin/agents). Every one passed FILTERS when it was found, and AliExpress pays a
// higher commission on them, which this page says plainly (/terms#affiliate).
import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { StandardProductCard } from "@/components/product-cards";
import { StateCard } from "@/components/state-card";
import { MIN_COMMISSION_PCT } from "@/lib/agents/finder/select";
import { recommendedProducts } from "@/lib/agents/server";
import { formatCount } from "@/lib/format";
import { FILTERS } from "@/lib/ranking/config";
import { withPromoValidity } from "@/lib/search/promo";
import { pageMetadata } from "@/lib/seo/page-meta";

export const metadata: Metadata = pageMetadata({
  title: "המומלצים שלנו",
  description:
    "מוצרים מאלי אקספרס שבחרנו מתוך מה שעבר את הסינון שלנו: משוב חיובי גבוה ומכירות רבות.",
  path: "/recommended",
});

// An hour; an approval or a removal in /admin/agents refreshes it at once (RECOMMENDED_TAG).
export const revalidate = 3600;

export default async function RecommendedPage() {
  // The badge's "valid now" with the render's clock: the page is regenerated at least hourly.
  const products = withPromoValidity(await recommendedProducts(), new Date().getTime());
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-3">
        <h1 className="font-display text-4xl">המומלצים שלנו</h1>
        <p id="about" className="max-w-prose leading-relaxed text-muted">
          מוצרים מאלי אקספרס שבחרנו בעצמנו. כל אחד עבר את הסינון שלנו כשמצאנו אותו (
          <bdi dir="ltr">{FILTERS.minPositiveFeedbackPct}%</bdi> משוב חיובי ומעלה ולפחות{" "}
          <bdi dir="ltr">{formatCount(FILTERS.minUnitsSold)}</bdi> מכירות ב־30 הימים האחרונים). על
          המוצרים בעמוד הזה אלי אקספרס משלמת לנו עמלה גבוהה מהרגיל (
          <bdi dir="ltr">{MIN_COMMISSION_PCT}%</bdi> ומעלה), וזו אחת הסיבות שבחרנו בהם. המחיר שלכם
          לא משתנה בגלל זה.{" "}
          <Link href="/terms#affiliate" className="underline underline-offset-4 hover:text-ink">
            על קישורי השותפים
          </Link>
        </p>
      </div>
      {!products.length ? (
        <StateCard Icon={Sparkles} title="עוד אין כאן מוצרים">
          <p className="max-w-md leading-relaxed text-muted">
            בקרוב נוסיף כאן מוצרים. בינתיים אפשר לחפש כל מוצר או לעבור על{" "}
            <Link href="/products" className="underline underline-offset-4">
              כל המוצרים
            </Link>
            .
          </p>
        </StateCard>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
          {products.map((p, i) => (
            <li key={p.product_id}>
              <StandardProductCard product={p} rank={i + 1} q="" src="recommended" rankOf={null} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">
        המחירים והנתונים מאלי אקספרס ונבדקו כשהמוצר נוסף; בעמוד של כל מוצר כתוב מתי נבדק המחיר
        לאחרונה. שמות המוצרים בתרגום אוטומטי של אלי אקספרס.
      </p>
    </div>
  );
}
