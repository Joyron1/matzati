"use client";

import { Share2 } from "lucide-react";
import { whatsappShareUrl } from "@/lib/format";
import { useMounted } from "@/lib/use-mounted";

/** Shares the current page of our site on WhatsApp (never the affiliate link). */
export function ShareLink({ text, label = "שיתוף בוואטסאפ" }: { text: string; label?: string }) {
  const mounted = useMounted();
  const href = mounted ? whatsappShareUrl(text, window.location.href) : undefined;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      aria-disabled={!mounted}
      className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
    >
      <Share2 aria-hidden className="size-[18px]" />
      {label}
      <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
    </a>
  );
}
