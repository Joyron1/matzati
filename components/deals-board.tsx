"use client";

import Link from "next/link";
import { Ban, CalendarClock, ChevronLeft, Tag, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { formatShortDate } from "@/lib/format";
import type { Deal, DealType } from "@/lib/types";
import { CopyButton } from "./copy-button";
import { card } from "./styles";

const TYPES: Record<DealType, { label: string; Icon: LucideIcon; tag: string }> = {
  deal: { label: "דילים", Icon: Tag, tag: "bg-gold text-on-gold" },
  holiday: { label: "חגים ומבצעים", Icon: CalendarClock, tag: "bg-accent-soft text-accent-ink" },
  dont_buy: { label: "לא לקנות", Icon: Ban, tag: "bg-invert-bg text-invert-ink" },
};

const FILTERS: { value: DealType | "all"; label: string }[] = [
  { value: "all", label: "הכול" },
  { value: "deal", label: TYPES.deal.label },
  { value: "holiday", label: TYPES.holiday.label },
  { value: "dont_buy", label: TYPES.dont_buy.label },
];

function DealDates({ deal }: { deal: Deal }) {
  if (deal.type === "holiday" && deal.starts_at) {
    return (
      <p className="text-sm text-muted">
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
  const { label, Icon, tag } = TYPES[deal.type];
  return (
    <article
      className={`${card} flex flex-col gap-4 p-5 ${deal.type === "dont_buy" ? "border-dashed" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${tag}`}
        >
          <Icon aria-hidden className="size-3.5" />
          {deal.type === "deal" ? "דיל" : label}
        </span>
        <DealDates deal={deal} />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg leading-snug font-bold">{deal.title}</h2>
        <p className="leading-relaxed text-muted">{deal.body}</p>
      </div>
      {deal.coupon_code && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-soft p-3 ps-4">
          <p className="text-sm">
            קופון:{" "}
            <bdi dir="ltr" className="font-bold tracking-wider">
              {deal.coupon_code}
            </bdi>
          </p>
          <CopyButton value={deal.coupon_code} />
        </div>
      )}
      {deal.product_id && (
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
  const shown = filter === "all" ? deals : deals.filter((d) => d.type === filter);

  return (
    <div className="space-y-6">
      <div role="group" aria-label="סינון לפי סוג" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const pressed = f.value === filter;
          return (
            <button
              key={f.value}
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
        מוצגים {shown.length} פריטים
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>
    </div>
  );
}
