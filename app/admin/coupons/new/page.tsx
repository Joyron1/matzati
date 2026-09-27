import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { formValuesFromCoupon } from "@/lib/coupons/schema";
import { CouponForm } from "../coupon-form";
import { loadSaleOptions } from "../sale-options";

export const metadata: Metadata = {
  title: "קופון חדש",
  robots: { index: false, follow: false },
};

export default async function NewCouponPage() {
  await requireAdmin();
  const sales = await loadSaleOptions(new Date());

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
        <h1 className="font-display text-4xl">קופון חדש</h1>
        <p className="text-muted">
          הקופון נשמר כטיוטה. הוא יופיע באתר רק אחרי שתפרסמו אותו מהרשימה. כתבו רק מה שכתוב בתנאי
          הקופון: באתר הוא מוצג כ״לפי תנאי הקופון״.
        </p>
      </div>
      {sales === null && (
        <p role="status" className="rounded-2xl bg-gold-soft px-4 py-3 text-sm font-semibold">
          לא הצלחנו לטעון את רשימת המבצעים, אז אפשר לשמור עכשיו רק ״ללא מבצע״.
        </p>
      )}
      <CouponForm couponId={null} initial={formValuesFromCoupon(null)} sales={sales} />
    </div>
  );
}
