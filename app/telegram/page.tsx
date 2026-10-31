// "/telegram": the landing page of the Meta campaigns (owner request 2026-10-31): one goal, joining
// the Telegram search group (lib/telegram/group/), with the same button repeated down the page.
// Everything it says is what the group does (CLAUDE.md "Telegram search group"): the numbers come
// from the code (FILTERS, the admin's daily limit), never a member count or a testimonial we do
// not have. Falls back to the channel when the group has no link, and to the home page when
// neither has. Not in the sitemap and noindex: a campaign page, not a search landing page.
import type { Metadata } from "next";
import Link from "next/link";
import { shortLived } from "@/lib/cache-lifetime";
import { pageMetadata } from "@/lib/seo/page-meta";
import { telegramJoinLinks } from "@/lib/telegram/join-links";
import { TelegramLandingView } from "./landing-view";

export const revalidate = 3600;

export const metadata: Metadata = {
  ...pageMetadata({
    title: "קבוצת החיפוש בטלגרם",
    description:
      "כותבים בקבוצה מה מחפשים, בעברית, ומקבלים את 5 המוצרים הכי מתאימים מאלי אקספרס, מסודרים לפי אמינות. חינם.",
    path: "/telegram",
  }),
  robots: { index: false, follow: true },
};

export default async function TelegramLandingPage() {
  const links = await telegramJoinLinks();
  const href = links.groupUrl ?? links.channelUrl;
  if (!href) {
    // Telegram did not answer: try again in a minute, not for the page's whole hour.
    await shortLived();
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-16 text-center">
        <h1 className="font-display text-3xl">הקבוצה בטלגרם</h1>
        <p className="text-muted">הקישור לקבוצה לא זמין כרגע. נסו שוב בעוד כמה דקות.</p>
        <Link href="/" className="font-semibold text-accent-ink underline">
          בינתיים, לחיפוש באתר
        </Link>
      </div>
    );
  }
  return <TelegramLandingView href={href} dailyLimit={links.dailyLimit} />;
}
