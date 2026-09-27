import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { getCoupon } from "@/lib/coupons/queries";
import { formValuesFromCoupon } from "@/lib/coupons/schema";
import { CouponForm } from "../coupon-form";
import { loadSaleOptions } from "../sale-options";

export const metadata: Metadata = {
  title: "עריכת קופון",
  robots: { index: false, follow: false },
};

export default async function EditCouponPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  // Ids that are not uuids come back null without a query.
  const [coupon, sales] = await Promise.all([getCoupon(id), loadSaleOptions(new Date())]);
  if (!coupon) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <Link
        href="/admin/coupons"
        className="inline-flex min-h-11 items-center gap-1 rounded-full pe-3 font-semibold text-muted hover:text-ink"
      >
        <ChevronRight aria-hidden className="size-5" />
        לרשימת הקופונים
      </Link>
      <div className="space-y-2">
        <h1 className="font-display text-4xl">עריכת קופון</h1>
        <p className="text-muted">
          {coupon.published
            ? "הקופון מפורסם. השינויים יופיעו באתר מיד אחרי השמירה."
            : "הקופון שמור כטיוטה ולא מופיע באתר."}
        </p>
      </div>
      {sales === null && (
        <p role="status" className="rounded-2xl bg-gold-soft px-4 py-3 text-sm font-semibold">
          לא הצלחנו לטעון את רשימת המבצעים. אפשר להשאיר את המבצע המקושר או לבחור ״ללא מבצע״.
        </p>
      )}
      <CouponForm couponId={coupon.id} initial={formValuesFromCoupon(coupon)} sales={sales} />
    </div>
  );
}
