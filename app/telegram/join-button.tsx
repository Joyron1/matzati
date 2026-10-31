"use client";

// The join button of the Telegram landing page. A click also sends Meta's standard "Lead" event,
// so the campaign can optimize for joins. fbq exists only once the visitor accepted marketing
// (components/analytics/meta-pixel.tsx loads it inside the consent gate), so without consent
// nothing is sent. Telegram opens in the same tab: from Instagram's in-app browser a t.me link
// opens the Telegram app.
import { joinButton, TelegramMark } from "@/components/telegram-mark";

/** White on the blue band (`light`), else Telegram's blue; `compact` for the sticky bar. */
export function JoinButton({
  href,
  label,
  light,
  compact,
}: {
  href: string;
  label: string;
  light?: boolean;
  compact?: boolean;
}) {
  return (
    <a
      href={href}
      rel="noopener"
      onClick={() => {
        const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
        if (typeof fbq === "function") fbq("track", "Lead", { content_name: "telegram_deals" });
      }}
      className={
        light
          ? "inline-flex h-14 w-full items-center justify-center gap-2 rounded-[10px] bg-white px-8 text-base font-bold text-tg-ink hover:brightness-95 sm:w-auto"
          : compact
            ? `${joinButton} sm:w-auto sm:px-8`
            : `${joinButton} h-14 text-base sm:w-auto sm:px-10`
      }
    >
      <TelegramMark className="size-6" />
      {label}
      <span className="sr-only">(נפתח בטלגרם)</span>
    </a>
  );
}
