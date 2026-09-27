// One owner coupon, shared by /coupons, /p/[productId] and /sales. A server component: the
// validity line is computed from the `now` prop, so the HTML is final and never re-rendered on
// the client (only CopyButton is interactive).
import Link from "next/link";
import { ChevronDown, ChevronLeft, Search, TicketPercent } from "lucide-react";
import { couponTiming, minSpendText, OWNER_COUPON_NOTE, timeOfDay } from "@/lib/coupons/display";
import type { Coupon } from "@/lib/coupons/types";
import { lastCoveredInstant } from "@/lib/deals/time";
import { formatShortDate } from "@/lib/format";
import { CopyButton } from "./copy-button";
import { btnMd, btnSecondary, card } from "./styles";

export interface CouponCardProps {
  coupon: Coupon;
  /** Time of the render, for "נגמר בעוד" / "מתחיל ב־". */
  now: Date;
  /** Product page and sale cards: a single row with the code and a copy button. */
  compact?: boolean;
  /** Heading level of the coupon title within the page (default 3). */
  headingLevel?: 2 | 3 | 4;
  /**
   * The link under the card: "לדף המוצר" for a product coupon, "לחיפוש מוצר" for a sitewide one.
   * Shown by default on the full card only (a product page would link to itself).
   */
  showLink?: boolean;
}

/**
 * "11.11", or "11.11 בשעה 10:00" when it is not midnight in Israel. An `end` at midnight is written
 * as the last day it covers (5.10 00:00 → "4.10"), as the /sales calendar marks days. The prefix
 * ("ב־", "(עד ") and the suffix stay on one line with the numbers next to them.
 */
function When({
  iso,
  prefix = "",
  suffix = "",
  end = false,
}: {
  iso: string;
  prefix?: string;
  suffix?: string;
  end?: boolean;
}) {
  const time = timeOfDay(iso);
  const day = end && !time ? lastCoveredInstant(iso) : iso;
  return (
    <>
      <span className="whitespace-nowrap">
        {prefix}
        <bdi dir="ltr">{formatShortDate(day)}</bdi>
        {!time && suffix}
      </span>
      {time && (
        <>
          {" "}
          בשעה{" "}
          <span className="whitespace-nowrap">
            <bdi dir="ltr">{time}</bdi>
            {suffix}
          </span>
        </>
      )}
    </>
  );
}

/**
 * "מתחיל ב־11.11", "נגמר בעוד 3 ימים (עד 5.10)", "ללא תאריך סיום" or "הסתיים", from the dates and
 * the time of the render. Also used for the AliExpress codes on /coupons.
 */
export function CouponValidity({
  startsAt,
  endsAt,
  now,
}: {
  startsAt: string | null;
  endsAt: string | null;
  now: Date;
}) {
  const timing = couponTiming({ starts_at: startsAt, ends_at: endsAt }, now);
  switch (timing.state) {
    case "upcoming":
      return (
        <>
          מתחיל <When iso={timing.startsAt} prefix="ב־" />
        </>
      );
    case "ending":
      return (
        <>
          נגמר בעוד {timing.left} <When iso={timing.endsAt} prefix="(עד " suffix=")" end />
        </>
      );
    case "open":
      return <>ללא תאריך סיום</>;
    case "ended":
      return <>הסתיים</>;
  }
}

/**
 * The code in a dashed monospace pill (O and 0 stay apart, and browser translation leaves it
 * alone), with the copy button beside it. Shared by every coupon and code on the site.
 */
export function CouponCodeRow({ code, className = "" }: { code: string; className?: string }) {
  // A long code wraps inside a rounded box rather than turning a full pill into an oval.
  const size = code.length > 16 ? "text-base" : "text-lg";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="min-w-0">
        <span className="sr-only">הקוד: </span>
        <bdi
          dir="ltr"
          translate="no"
          className={`inline-block max-w-full rounded-2xl border-2 border-dashed border-muted bg-surface px-4 py-1.5 font-mono ${size} leading-snug font-bold tracking-wider break-all text-ink`}
        >
          {code}
        </bdi>
      </p>
      <CopyButton value={code} label={`של הקוד ${code}`} />
    </div>
  );
}

function CouponLink({ coupon }: { coupon: Coupon }) {
  // A sitewide coupon has no product to open; it never links to AliExpress directly.
  if (coupon.scope === "product" && coupon.product_id) {
    return (
      <Link
        href={`/p/${coupon.product_id}`}
        className="mt-auto inline-flex min-h-11 items-center gap-1 self-start font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        לדף המוצר
        <span className="sr-only">: {coupon.title}</span>
        <ChevronLeft aria-hidden className="size-4" />
      </Link>
    );
  }
  return (
    <Link href="/" className={`${btnSecondary} ${btnMd} mt-auto self-start`}>
      <Search aria-hidden className="size-4" />
      לחיפוש מוצר
    </Link>
  );
}

export function CouponCard({
  coupon,
  now,
  compact = false,
  headingLevel = 3,
  showLink = !compact,
}: CouponCardProps) {
  const Heading = `h${headingLevel}` as const;
  const validity = <CouponValidity startsAt={coupon.starts_at} endsAt={coupon.ends_at} now={now} />;
  const minSpend = minSpendText(coupon.min_spend_ils);

  if (compact) {
    return (
      <article className="space-y-3 rounded-card bg-gold-soft p-4">
        <div className="space-y-1">
          <Heading className="leading-snug font-semibold text-ink">{coupon.title}</Heading>
          <p className="text-sm text-muted">
            {minSpend && <>{minSpend} · </>}
            {validity}
          </p>
        </div>
        <CouponCodeRow code={coupon.code} className="rounded-2xl bg-surface p-2 ps-3" />
        {coupon.terms && (
          <details className="group text-sm">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full font-semibold text-ink [&::-webkit-details-marker]:hidden">
              תנאי הקופון
              <ChevronDown aria-hidden className="size-4 group-open:rotate-180" />
            </summary>
            <p className="leading-relaxed whitespace-pre-line text-muted">{coupon.terms}</p>
          </details>
        )}
        <p className="text-xs leading-relaxed text-muted">{OWNER_COUPON_NOTE}</p>
        {showLink && <CouponLink coupon={coupon} />}
      </article>
    );
  }

  return (
    <article className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-bold whitespace-nowrap text-on-gold">
          <TicketPercent aria-hidden className="size-3.5" />
          {coupon.scope === "product" ? "קופון למוצר" : "קופון לכל האתר"}
        </span>
        <p className="text-sm text-muted">{validity}</p>
      </div>
      <div className="space-y-1">
        <Heading className="text-lg leading-snug font-bold break-words">{coupon.title}</Heading>
        {minSpend && <p className="font-semibold text-ink">{minSpend}</p>}
      </div>
      <CouponCodeRow code={coupon.code} className="rounded-2xl bg-gold-soft p-2 ps-3" />
      {coupon.terms && (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">תנאי הקופון</p>
          <p className="leading-relaxed whitespace-pre-line text-muted">{coupon.terms}</p>
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted">{OWNER_COUPON_NOTE}</p>
      {showLink && <CouponLink coupon={coupon} />}
    </article>
  );
}
