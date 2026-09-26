import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, ChevronRight, Info, Lightbulb, TicketPercent } from "lucide-react";
import { BuyButton } from "@/components/buy-button";
import { CopyButton } from "@/components/copy-button";
import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { ShareLink } from "@/components/share-link";
import { card, featured } from "@/components/styles";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatPct, formatShortDate } from "@/lib/format";
import { MOCK_COUPONS, MOCK_TIPS } from "@/lib/mock/deals";
import { mockIconFor } from "@/lib/mock/icons";
import { getMockProduct } from "@/lib/mock/products";
import { FILTERS } from "@/lib/ranking/config";
import { firstParam, searchHref } from "@/lib/search-url";

export async function generateMetadata({ params }: PageProps<"/p/[productId]">): Promise<Metadata> {
  const product = getMockProduct((await params).productId);
  return { title: product?.title_he ?? "מוצר לא נמצא" };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/p/[productId]">) {
  const { productId } = await params;
  const q = firstParam((await searchParams).q).trim();
  const product = getMockProduct(productId);
  if (!product) notFound();

  const coupon = MOCK_COUPONS[product.product_id];
  const tips = product.category_id ? MOCK_TIPS[product.category_id] : undefined;
  const Icon = mockIconFor(product.product_id);

  const checks = [
    product.positive_feedback_pct !== null && {
      label: "משוב חיובי",
      value: formatPct(product.positive_feedback_pct),
      threshold: `${FILTERS.minPositiveFeedbackPct}%`,
    },
    product.units_sold !== null && {
      label: "מכירות",
      value: formatCount(product.units_sold),
      threshold: formatCount(FILTERS.minUnitsSold),
    },
  ].filter((c) => c !== false);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-8">
      <Link
        href={q ? searchHref({ q }) : "/"}
        className="inline-flex min-h-11 items-center gap-1 rounded-full pe-3 font-semibold text-muted hover:text-ink"
      >
        <ChevronRight aria-hidden className="size-5" />
        {q ? "חזרה לתוצאות" : "לחיפוש חדש"}
      </Link>

      <div className="mt-3 grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="space-y-3">
          <ProductImage
            src={product.image_urls[0]}
            alt={product.title_he}
            fallbackIcon={Icon}
            className="aspect-square w-full rounded-composer"
            iconClassName="size-32"
            priority
          />
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl leading-snug font-bold sm:text-3xl">{product.title_he}</h1>
            <p className="text-sm text-muted">
              השם באלי אקספרס:{" "}
              <bdi dir="ltr" className="text-ink/80">
                {product.title_en}
              </bdi>
            </p>
          </div>

          <div className="space-y-2">
            <Price product={product} size="lg" />
            {product.price_is_approx && <p className="text-sm text-muted">{APPROX_PRICE_NOTE}</p>}
          </div>

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
                <dt className="text-sm text-muted">נמכרו</dt>
                <dd className="text-2xl font-bold">
                  <bdi dir="ltr">{formatCount(product.units_sold)}</bdi>
                </dd>
              </div>
            )}
          </dl>

          {coupon && (
            <section
              aria-labelledby="coupon-title"
              className="space-y-3 rounded-card bg-gold-soft p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="coupon-title" className="flex items-center gap-2 font-bold">
                    <TicketPercent aria-hidden className="size-5" />
                    קופון מהקהילה
                  </h2>
                  <p className="text-sm">
                    <bdi dir="ltr" className="font-bold tracking-wider">
                      {coupon.code}
                    </bdi>{" "}
                    · {coupon.description_he}
                    {coupon.valid_until && (
                      <>
                        {" "}
                        · בתוקף עד <bdi dir="ltr">{formatShortDate(coupon.valid_until)}</bdi>
                      </>
                    )}
                  </p>
                </div>
                <CopyButton value={coupon.code} />
              </div>
              <p className="text-xs text-muted">
                קופון שמשתמשים שיתפו. לא תמיד עובד לכולם, כדאי לבדוק בקופה.
              </p>
            </section>
          )}

          <BuyButton productId={product.product_id} src="product" />
          <ShareLink text={product.title_he} />
        </div>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="why-title" className={`${featured} space-y-4 p-6`}>
          <h2 id="why-title" className="font-display text-2xl">
            למה זה עבר את הסינון
          </h2>
          <ul className="space-y-3">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-3">
                <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                <p>
                  <span className="font-semibold">
                    {c.label}: <bdi dir="ltr">{c.value}</bdi>
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
            בחיפוש עצמו בדקנו גם שהמחיר בתוך התקציב שכתבתם ושהמוצר מתאים למה שביקשתם. כל המספרים כאן
            הגיעו מאלי אקספרס.
          </p>
        </section>

        {tips && (
          <section aria-labelledby="tips-title" className={`${card} space-y-4 p-6`}>
            <div className="space-y-1">
              <h2 id="tips-title" className="flex items-center gap-2 font-display text-2xl">
                <Lightbulb aria-hidden className="size-6 text-accent" />
                טיפים לקניית {tips.category_name_he}
              </h2>
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <Info aria-hidden className="size-4 shrink-0" />
                טיפים כלליים לקטגוריה, לא בדיקה של המוצר הזה.
              </p>
            </div>
            <ul className="space-y-3">
              {tips.tips_he.map((tip) => (
                <li key={tip} className="flex gap-3 leading-relaxed">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
