import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, CircleCheck, CircleMinus } from "lucide-react";
import { BuyButton } from "@/components/buy-button";
import { Price } from "@/components/price";
import { ProductGallery } from "@/components/product-gallery";
import { ShareLink } from "@/components/share-link";
import { card, featured } from "@/components/styles";
import { SOLD_30D_LABEL } from "@/components/trust-metrics";
import { APPROX_PRICE_NOTE } from "@/lib/copy";
import { formatCount, formatDateTime, formatPct } from "@/lib/format";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import { firstParam, searchHref } from "@/lib/search-url";
import { productForPage } from "@/lib/search/server";

// productForPage is request-cached, so the metadata and the page share one lookup.
export async function generateMetadata({ params }: PageProps<"/p/[productId]">): Promise<Metadata> {
  const data = await productForPage((await params).productId);
  return { title: data?.product.title_he ?? "מוצר לא נמצא" };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/p/[productId]">) {
  const { productId } = await params;
  const q = firstParam((await searchParams).q)
    .trim()
    .slice(0, 200);
  const data = await productForPage(productId);
  if (!data) notFound();

  const { product, shopName, updatedAt } = data;
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
  // Without a Hebrew title the page falls back to the English one.
  const englishOnly = product.title_he === product.title_en;

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
        <ProductGallery images={product.image_urls} alt={product.title_he} />

        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl leading-snug font-bold sm:text-3xl">
              {englishOnly ? <bdi dir="ltr">{product.title_en}</bdi> : product.title_he}
            </h1>
            {!englishOnly && (
              <p className="text-sm text-muted">
                השם באלי אקספרס:{" "}
                <bdi dir="ltr" className="text-ink/80">
                  {product.title_en}
                </bdi>
              </p>
            )}
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
              המחיר נבדק באלי אקספרס ב־<bdi dir="ltr">{formatDateTime(updatedAt)}</bdi>.
            </p>
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
                <dt className="text-sm text-muted">{SOLD_30D_LABEL}</dt>
                <dd className="text-2xl font-bold">
                  <bdi dir="ltr">{formatCount(product.units_sold)}</bdi>
                </dd>
              </div>
            )}
          </dl>

          <BuyButton productId={product.product_id} src="product" />
          <ShareLink text={product.title_he} />
        </div>
      </div>

      <section aria-labelledby="why-title" className={`${featured} mt-12 max-w-3xl space-y-4 p-6`}>
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
                  {c.value === null ? "אלי אקספרס לא החזירה נתון" : <bdi dir="ltr">{c.value}</bdi>}
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
    </div>
  );
}
