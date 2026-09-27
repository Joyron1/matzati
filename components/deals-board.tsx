"use client";

import Link from "next/link";
import { ChevronLeft, Inbox } from "lucide-react";
import { useRef, useState } from "react";
import { BRAND } from "@/lib/config/brand";
import { DEAL_TYPE_DISPLAY, DEAL_TYPE_TAG } from "@/lib/deals/display";
import { formatShortDate } from "@/lib/format";
import type { Deal, DealType } from "@/lib/types";
import { COUPON_DISCLAIMER } from "./community-coupon";
import { CopyButton } from "./copy-button";
import { StateCard } from "./state-card";
import { btnMd, btnSecondary, card } from "./styles";

const FILTERS: { value: DealType | "all"; label: string }[] = [
  { value: "all", label: "הכול" },
  { value: "deal", label: DEAL_TYPE_DISPLAY.deal.label },
  { value: "holiday", label: DEAL_TYPE_DISPLAY.holiday.label },
  { value: "dont_buy", label: DEAL_TYPE_DISPLAY.dont_buy.label },
];

// Always rendered from the stored dates (not from "now"), so server and client HTML match. A deal
// or coupon that has not started yet shows its start date instead of looking usable today.
function DealDates({ deal }: { deal: Deal }) {
  if (deal.starts_at) {
    return (
      <p className="text-sm text-muted">
        {deal.type === "holiday" ? null : "מ־"}
        <bdi dir="ltr">{formatShortDate(deal.starts_at)}</bdi>
        {deal.ends_at && (
          <>
            {" "}
            עד <bdi dir="ltr">{formatShortDate(deal.ends_at)}</bdi>
          </>
        )}
      </p>
    );
  }
  if (deal.ends_at) {
    return (
      <p className="text-sm text-muted">
        בתוקף עד <bdi dir="ltr">{formatShortDate(deal.ends_at)}</bdi>
      </p>
    );
  }
  return null;
}

function DealCard({ deal }: { deal: Deal }) {
  const { tagLabel, Icon, tag } = DEAL_TYPE_DISPLAY[deal.type];
  return (
    <article
      className={`${card} flex flex-col gap-4 p-5 ${deal.type === "dont_buy" ? "border-dashed" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`${DEAL_TYPE_TAG} ${tag}`}>
          <Icon aria-hidden className="size-3.5" />
          {tagLabel}
        </span>
        <DealDates deal={deal} />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg leading-snug font-bold">{deal.title}</h2>
        {deal.body && <p className="leading-relaxed whitespace-pre-line text-muted">{deal.body}</p>}
      </div>
      {deal.coupon_code && (
        <div className="space-y-2 rounded-2xl bg-gold-soft p-3 ps-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              קופון:{" "}
              <bdi dir="ltr" className="font-bold tracking-wider">
                {deal.coupon_code}
              </bdi>
            </p>
            <CopyButton value={deal.coupon_code} />
          </div>
          {/* Same note as on /p: we cannot promise a community coupon works for everyone. */}
          <p className="text-xs leading-relaxed text-muted">{COUPON_DISCLAIMER}</p>
        </div>
      )}
      {/* A "don't buy" warning never links to a page with a buy button. */}
      {deal.product_id && deal.type !== "dont_buy" && (
        <Link
          href={`/p/${deal.product_id}`}
          className="mt-auto inline-flex min-h-11 items-center gap-1 self-start font-semibold text-accent-ink underline-offset-4 hover:underline"
        >
          לפרטי המוצר
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      )}
    </article>
  );
}

export function DealsBoard({ deals }: { deals: Deal[] }) {
  const [filter, setFilter] = useState<DealType | "all">("all");
  const showAllRef = useRef<HTMLButtonElement>(null);
  const shown = filter === "all" ? deals : deals.filter((d) => d.type === filter);

  if (deals.length === 0) {
    return (
      <StateCard Icon={Inbox} title="עוד אין כאן דילים">
        <p className="max-w-md leading-relaxed text-muted">
          {/* Point to the WhatsApp channel only once it exists (the CTA below says "בקרוב"). */}
          {BRAND.whatsappChannelUrl
            ? "אנחנו מעלים רק דילים שבדקנו. הצטרפו לערוץ הוואטסאפ למטה ונעדכן כשיעלו חדשים."
            : "אנחנו מעלים רק דילים שבדקנו. בינתיים כתבו בחיפוש מה אתם צריכים, ונציג 3 מוצרים שעברו את הסינון."}
        </p>
        <Link href="/" className={`${btnSecondary} ${btnMd}`}>
          לחיפוש מוצר
        </Link>
      </StateCard>
    );
  }

  return (
    <div className="space-y-6">
      <div role="group" aria-label="סינון לפי סוג" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const pressed = f.value === filter;
          return (
            <button
              key={f.value}
              ref={f.value === "all" ? showAllRef : undefined}
              type="button"
              aria-pressed={pressed}
              onClick={() => setFilter(f.value)}
              className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold ${
                pressed
                  ? "bg-ink text-bg"
                  : "border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {shown.length === 1 ? "מוצג פריט אחד" : `מוצגים ${shown.length} פריטים`}
      </p>
      {shown.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      ) : (
        <StateCard Icon={Inbox} title="אין כרגע פריטים מהסוג הזה">
          <button
            type="button"
            onClick={() => {
              setFilter("all");
              // This button goes away with the empty state; keep focus on the filters.
              showAllRef.current?.focus();
            }}
            className={`${btnSecondary} ${btnMd}`}
          >
            הצגת הכול
          </button>
        </StateCard>
      )}
    </div>
  );
}
