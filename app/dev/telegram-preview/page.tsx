// Development-only preview of the home page's Telegram section (components/telegram-join.tsx)
// with made-up links (?only=channel|group shows one card). A 404 in production, noindex,
// disallowed in robots.txt (/dev/). Nothing here calls Telegram.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TelegramJoinView } from "@/components/telegram-join";
import { firstParam } from "@/lib/search-url";

export const metadata: Metadata = {
  title: "תצוגה מקדימה: טלגרם",
  robots: { index: false, follow: false },
};

export default async function TelegramPreview({
  searchParams,
}: PageProps<"/dev/telegram-preview">) {
  if (process.env.NODE_ENV === "production") notFound();
  const only = firstParam((await searchParams).only);
  return (
    <div className="pb-16">
      <TelegramJoinView
        links={{
          channelUrl: only === "group" ? null : "https://t.me/example_channel",
          groupUrl: only === "channel" ? null : "https://t.me/+exampleInvite",
          dailyLimit: 10,
          pollEnabled: true,
        }}
      />
    </div>
  );
}
