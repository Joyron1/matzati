import type { Metadata } from "next";
import { DealsBoard } from "@/components/deals-board";
import { WhatsappCta } from "@/components/whatsapp-cta";
import { MOCK_DEALS } from "@/lib/mock/deals";

export const metadata: Metadata = {
  title: "דילים ומבצעים",
  description: "דילים שנבחרו ידנית, תזכורות למבצעים גדולים ומוצרים שעדיף לא לקנות באלי אקספרס.",
};

export default function DealsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="max-w-2xl space-y-3">
        <h1 className="font-display text-4xl sm:text-5xl">דילים ומבצעים</h1>
        <p className="text-lg leading-relaxed text-muted">
          הצוות בוחר ידנית דילים, מזכיר מתי מתחילים המבצעים הגדולים, ומסמן מוצרים שעדיף לא לקנות.
          אין כאן מקומות ממומנים.
        </p>
      </div>
      <DealsBoard deals={MOCK_DEALS} />
      <WhatsappCta />
    </div>
  );
}
