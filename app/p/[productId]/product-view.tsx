// The /p page body, shared by the page and the dev preview (app/dev/preview). Two columns from lg:
// the gallery (video first) sticks while the details scroll (title, price, numbers, coupons and
// codes, buy button, share, why it passed our filters, reviews, variants); then, at full width,
// the category tips and the similar products. One column on phones, in the same order.
// Everything comes in as props (productForPage loads it; the similar products arrive as a slot the
// page streams), so the view never fetches anything.
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, CircleCheck, CircleMinus } from "lucide-react";
import { ApiPromoCode } from "@/components/api-promo-code";
import { BuyButton } from "@/components/buy-button";
import { CategoryTips } from "@/components/category-tips";
import { CommunityCoupon } from "@/components/community-coupon";
import { CouponCard } from "@/components/coupon-card";
import { Price } from "@/components/price";
import { ProductGallery } from "@/components/product-gallery";
import { videoPosterSrc } from "@/components/product-video";
import { ReviewsCard } from "@/components/reviews-card";
import { ShareLink } from "@/components/share-link";
import { SkuVariants } from "@/components/sku-variants";
import { card } from "@/components/styles";
import { SOLD_30D_LABEL } from "@/components/trust-metrics";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime, formatPct } from "@/lib/format";
import { PRODUCT_TITLE_NOTE } from "@/lib/hot/copy";
import { productTitleView } from "@/lib/product-title";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import { searchHref } from "@/lib/search-url";
import type { ProductPageData } from "@/lib/search/server";

/** The back link: to the search the visitor came from, to /hot, or to a new search. */
function backLink(q: string, hotBack: string | null) {
  if (q) return { href: searchHref({ q }), label: "חזרה לתוצאות" };
  if (hotBack) return { href: hotBack, label: "חזרה למוצרים החמים" };
  return { href: "/", label: "לחיפוש חדש" };
}

/**
 * `q` is the search the visitor came from ("" for none); `hotBack` the /hot list a card was opened
 * from (hotBackHref), or null; `now` is the time of the render. `similar` is shown last, at full
 * width: the page passes the similar products there (components/similar-products.tsx), streamed.
 */
export function ProductView({
  data,
  q,
  hotBack = null,
  now,
  similar = null,
}: {
  data: ProductPageData;
  q: string;
  hotBack?: string | null;
  now: Date;
  similar?: ReactNode;
}) {
  const {
    product,
    shopName,
    updatedAt,
    tips,
    tipsCategoryHe,
    coupon,
    ownerCoupons,
    apiCoupon,
    videoUrl,
    skuDetails,
  } = data;
  const hasCoupons = ownerCoupons.length > 0 || apiCoupon !== null || coupon !== null;
  const pct = product.positive_feedback_pct;
  const sold = product.units_sold;
  // Re-evaluated on current data: values change after a search, and /p can also be opened for a
  // product no search showed. A missing value fails, as it does in the ranking filter.
  // Show the thresholds this product actually met: FILL_TIER products (niche items topped up when
  // too few met FILTERS) are held to a higher feedback bar and a lower sales bar.
  const trust = product.passed_tier === "fill" ? FILL_TIER : FILTERS;
  const checks = [
    {
      label: "משוב חיובי",
      value: pct === null ? null : formatPct(pct),
      threshold: `${trust.minPositiveFeedbackPct}%`,
      passes: pct !== null && pct >= trust.minPositiveFeedbackPct,
    },
    {
      label: SOLD_30D_LABEL,
      value: sold === null ? null : formatCount(sold),
      threshold: formatCount(trust.minUnitsSold),
      passes: sold !== null && sold >= trust.minUnitsSold,
    },
  ];
  const allPass = checks.every((c) => c.passes);
  // Without a Hebrew title of ours the page shows AliExpress's: English, or its Hebrew machine
  // translation for a product saved from a hot list. The direction comes from the letters.
  const title = productTitleView(product.title_he, product.title_en);
  const back = backLink(q, hotBack);

  const video = videoUrl ? { src: videoUrl, poster: videoPosterSrc(product.image_urls[0]) } : null;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-8">
      <Link
        href={back.href}
        className="inline-flex min-h-11 items-center gap-1 rounded-full pe-3 font-semibold text-muted hover:text-ink"
      >
        <ChevronRight aria-hidden className="size-5" />
        {back.label}
      </Link>

      {/* From lg the gallery sticks (the header scrolls away, so just under the window's top) while
          the details scroll, until the tips below the two columns. On phones nothing sticks. */}
      <div className="mt-3 grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-x-12">
        <div className="min-w-0 lg:sticky lg:top-6">
          <ProductGallery images={product.image_urls} alt={title.text} video={video} />
        </div>

        <div className="min-w-0 space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl leading-snug font-bold sm:text-3xl">
              {title.ltr ? <bdi dir="ltr">{title.text}</bdi> : title.text}
            </h1>
            {title.original !== null && (
              <p className="text-sm text-muted">
                השם באלי אקספרס:{" "}
                <bdi dir="ltr" className="text-ink/80">
                  {title.original}
                </bdi>
              </p>
            )}
            {title.machineTranslated && <p className="text-sm text-muted">{PRODUCT_TITLE_NOTE}</p>}
            {shopName && (
              <p className="text-sm text-muted">
                החנות: <bdi className="text-ink/80">{shopName}</bdi>
              </p>
            )}
          </div>

          {product.why_he && (
            <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-accent-ink">
              <span className="font-bold">למה בחרנו: </span>
              {product.why_he}
            </p>
          )}

          <div className="space-y-2">
            <Price product={product} size="lg" />
            <p className="text-sm text-muted">
              {product.price_is_approx && <>{APPROX_PRICE_NOTE} </>}
              המחיר נבדק באלי אקספרס ב־
              <time dateTime={updatedAt}>{formatDateTime(updatedAt)}</time>.
            </p>
          </div>

          {(product.positive_feedback_pct !== null || product.units_sold !== null) && (
            <dl className="grid grid-cols-2 gap-3">
              {product.positive_feedback_pct !== null && (
                <div className={`${card} flex flex-col-reverse gap-1 p-4`}>
                  <dt className="text-sm text-muted">משוב חיובי מקונים</dt>
                  <dd className="text-2xl font-bold">
                    <bdi dir="ltr">{formatPct(product.positive_feedback_pct)}</bdi>
                  </dd>
                </div>
              )}
              {product.units_sold !== null && (
                <div className={`${card} flex flex-col-reverse gap-1 p-4`}>
                  <dt className="text-sm text-muted">{SOLD_30D_LABEL}</dt>
                  <dd className="text-2xl font-bold">
                    <bdi dir="ltr">{formatCount(product.units_sold)}</bdi>
                  </dd>
                </div>
              )}
            </dl>
          )}

          {/* Owner coupons first; the community coupon is only a fallback (productForPage). */}
          {hasCoupons && (
            <div className="space-y-3">
              {/* h2 like the AliExpress and community coupon beside it: they sit under the h1. */}
              {ownerCoupons.map((c) => (
                <CouponCard key={c.id} coupon={c} now={now} compact headingLevel={2} />
              ))}
              {apiCoupon && <ApiPromoCode code={apiCoupon} checkedAt={updatedAt} />}
              {coupon && <CommunityCoupon deal={coupon} />}
            </div>
          )}

          <div className="space-y-1">
            {/* The affiliate disclosure stays directly under the buy button (inside BuyButton). */}
            <BuyButton productId={product.product_id} src="product" />
            <div className="flex justify-center">
              <ShareLink text={title.text} />
            </div>
          </div>

          <section aria-labelledby="why-title" className={`${card} space-y-4 p-5 sm:p-6`}>
            <h2 id="why-title" className="font-display text-2xl">
              {allPass ? "למה זה עבר את הסינון" : "איך המוצר עומד בסינון שלנו"}
            </h2>
            <ul className="space-y-3">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3">
                  {c.passes ? (
                    <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                  ) : (
                    <CircleMinus aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
                  )}
                  <p>
                    <span className="sr-only">{c.passes ? "עומד בסף. " : "לא עומד בסף. "}</span>
                    <span className="font-semibold">
                      {c.label}:{" "}
                      {c.value === null ? (
                        "אלי אקספרס לא החזירה נתון"
                      ) : (
                        <bdi dir="ltr">{c.value}</bdi>
                      )}
                    </span>
                    <span className="text-muted">
                      {" "}
                      (הסף שלנו: <bdi dir="ltr">{c.threshold}</bdi> ומעלה)
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed text-muted">
              {allPass
                ? "בחיפוש אנחנו בודקים גם שהמוצר מתאים למה שביקשתם ושהמחיר בתוך התקציב שכתבתם."
                : "לפי הנתונים העדכניים מאלי אקספרס, המוצר לא עומד כרגע בכל הספים שלנו."}{" "}
              כל המספרים כאן הגיעו מאלי אקספרס.
            </p>
          </section>

          <ReviewsCard productId={product.product_id} />

          {skuDetails && <SkuVariants details={skuDetails} />}
        </div>
      </div>

      {tips && <CategoryTips tips={tips} categoryHe={tipsCategoryHe} wide className="mt-12" />}

      {similar}
    </div>
  );
}
