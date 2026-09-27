import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { getDeal } from "@/lib/deals/queries";
import { formValuesFromDeal } from "@/lib/deals/schema";
import { DealForm } from "../deal-form";

export const metadata: Metadata = {
  title: "עריכת דיל",
  robots: { index: false, follow: false },
};

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  // Ids that are not uuids come back null without a query.
  const deal = await getDeal(id);
  if (!deal) notFound();

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
        <h1 className="font-display text-4xl">עריכת דיל</h1>
        <p className="text-muted">
          {deal.published
            ? "הדיל מפורסם. השינויים יופיעו באתר מיד אחרי השמירה."
            : "הדיל שמור כטיוטה ולא מופיע באתר."}
        </p>
      </div>
      <DealForm dealId={deal.id} initial={formValuesFromDeal(deal)} />
    </div>
  );
}
