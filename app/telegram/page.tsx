// "/telegram": the landing page of the Meta campaigns (owner requests 2026-10-31): one goal,
// joining the Telegram group t.me/matzati_deals, where vetted products are posted. The content is
// in ./landing-view.tsx. Cached an hour; the next big sale (the admin's sales calendar) shows a
// countdown, and a failed read only hides it. Not in the sitemap and noindex: a campaign page.
import type { Metadata } from "next";
import { nextSale } from "@/lib/deals/queries";
import { pageMetadata } from "@/lib/seo/page-meta";
import { landingSale, TelegramLandingView } from "./landing-view";

export const revalidate = 3600;

export const metadata: Metadata = {
  ...pageMetadata({
    title: "קבוצת הטלגרם של מצאתי",
    description:
      "קבוצת טלגרם שקטה: רק מוצרים איכותיים ואמינים מאלי אקספרס שעברו את הסינון שלנו, ממוצרי חשמל, מוצרים לילדים ואקסטרות לעגלה. חינם.",
    path: "/telegram",
  }),
  robots: { index: false, follow: true },
};

export default async function TelegramLandingPage() {
  const now = new Date();
  const sale = await nextSale(now).catch((err: unknown) => {
    console.error(
      `[telegram-landing] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return null;
  });
  return <TelegramLandingView sale={landingSale(sale)} renderedAt={now.getTime()} />;
}
