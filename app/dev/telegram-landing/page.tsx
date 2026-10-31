// Development-only preview of the /telegram landing page with a made-up join link. A 404 in
// production, noindex, disallowed in robots.txt (/dev/). Nothing here calls Telegram.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TelegramLandingView } from "@/app/telegram/landing-view";

export const metadata: Metadata = {
  title: "תצוגה מקדימה: עמוד הטלגרם",
  robots: { index: false, follow: false },
};

export default function TelegramLandingPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TelegramLandingView href="https://t.me/+exampleInvite" dailyLimit={10} />;
}
