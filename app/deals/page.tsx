import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CloudOff } from "lucide-react";
import { DealsBoard } from "@/components/deals-board";
import { StateCard } from "@/components/state-card";
import { WhatsappCta } from "@/components/whatsapp-cta";
import { DEALS_ENABLED } from "@/lib/config/site";
import { listPublishedDeals } from "@/lib/deals/queries";
import type { Deal } from "@/lib/types";

export const metadata: Metadata = {
  title: "דילים ומבצעים",
  description: "דילים שנבחרו ידנית, תזכורות למבצעים גדולים ומוצרים שעדיף לא לקנות באלי אקספרס.",
};

async function loadDeals(): Promise<Deal[] | null> {
  try {
    return await listPublishedDeals(new Date());
  } catch (err) {
    console.error(`[deals] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    return null;
  }
}

export default async function DealsPage() {
  if (!DEALS_ENABLED) notFound();
  // Rendered per request: which deals have ended depends on the time of the visit.
  await connection();
  const deals = await loadDeals();

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="max-w-2xl space-y-3">
        <h1 className="font-display text-4xl sm:text-5xl">דילים ומבצעים</h1>
        <p className="text-lg leading-relaxed text-muted">
          הצוות בוחר ידנית דילים, מזכיר מתי מתחילים המבצעים הגדולים, ומסמן מוצרים שעדיף לא לקנות.
          אין כאן מקומות ממומנים.
        </p>
      </div>
      {deals ? (
        <DealsBoard deals={deals} />
      ) : (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את הדילים">
          <p className="max-w-md leading-relaxed text-muted">נסו לרענן את הדף בעוד רגע.</p>
        </StateCard>
      )}
      <WhatsappCta />
    </div>
  );
}
