import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { formValuesFromDeal } from "@/lib/deals/schema";
import { DealForm } from "../deal-form";

export const metadata: Metadata = {
  title: "דיל חדש",
  robots: { index: false, follow: false },
};

export default async function NewDealPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center gap-1 rounded-full pe-3 font-semibold text-muted hover:text-ink"
      >
        <ChevronRight aria-hidden className="size-5" />
        לרשימת הדילים
      </Link>
      <div className="space-y-2">
        <h1 className="font-display text-4xl">דיל חדש</h1>
        <p className="text-muted">הדיל נשמר כטיוטה. הוא יופיע באתר רק אחרי שתפרסמו אותו מהרשימה.</p>
      </div>
      <DealForm dealId={null} initial={formValuesFromDeal(null)} />
    </div>
  );
}
