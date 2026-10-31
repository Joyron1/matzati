// Development-only preview of the /telegram landing page with a made-up sale 11 days ahead
// (?sale=none hides it). A 404 in production, noindex, disallowed in robots.txt (/dev/).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TelegramLandingView } from "@/app/telegram/landing-view";
import { firstParam } from "@/lib/search-url";

export const metadata: Metadata = {
  title: "תצוגה מקדימה: עמוד הטלגרם",
  robots: { index: false, follow: false },
};

export default async function TelegramLandingPreview({
  searchParams,
}: PageProps<"/dev/telegram-landing">) {
  if (process.env.NODE_ENV === "production") notFound();
  const none = firstParam((await searchParams).sale) === "none";
  const now = new Date().getTime();
  const day = 86_400_000;
  return (
    <TelegramLandingView
      renderedAt={now}
      sale={
        none
          ? null
          : {
              id: "00000000-0000-0000-0000-000000000000",
              title: "11.11: פסטיבל הקניות העולמי",
              startsAt: new Date(now + 11 * day).toISOString(),
              endsAt: new Date(now + 20 * day).toISOString(),
            }
      }
    />
  );
}
