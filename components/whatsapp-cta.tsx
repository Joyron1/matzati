import { MessageCircle } from "lucide-react";
import { BRAND } from "@/lib/config/brand";
import { btnGold, btnLg } from "./styles";

export function WhatsappCta() {
  const url = BRAND.whatsappChannelUrl;
  return (
    <section
      id="whatsapp"
      aria-labelledby="whatsapp-title"
      className="flex scroll-mt-6 flex-col gap-5 rounded-composer bg-invert-bg p-6 text-invert-ink sm:flex-row sm:items-center sm:justify-between sm:p-8"
    >
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gold text-on-gold">
          <MessageCircle aria-hidden className="size-6" />
        </span>
        <div className="space-y-1">
          <h2 id="whatsapp-title" className="font-display text-2xl">
            דילים ותזכורות למבצעים בוואטסאפ
          </h2>
          <p className="opacity-85">
            הצטרפו לערוץ. רק דילים שעברו את הסינון שלנו, ותזכורת לפני כל מבצע גדול.
          </p>
        </div>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener" className={`${btnGold} ${btnLg} shrink-0`}>
          הצטרפות לערוץ
          <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
        </a>
      ) : (
        <span className="shrink-0 rounded-full border border-current/40 px-6 py-3 text-sm font-semibold">
          הערוץ ייפתח בקרוב
        </span>
      )}
    </section>
  );
}
