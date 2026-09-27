"use client";

import Link from "next/link";
import {
  Bell,
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { useId, useSyncExternalStore, type ReactNode } from "react";
import { formatShortDate, timeUntil, type TimeLeft } from "@/lib/format";
import { DEALS_ENABLED } from "@/lib/config/site";
import { SALE_DATES_NOTE } from "@/lib/copy";
import { formatTimeLeft, lastCoveredInstant } from "@/lib/deals/time";
import { btnMd, btnPrimary, btnSecondary } from "./styles";

// Ticks once per minute; the snapshot is the current minute so renders stay cheap.
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 15_000);
  return () => clearInterval(id);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);

/**
 * The minute to render. Server HTML and hydration use `renderedAt` (when the server rendered, in
 * ms), so a sale that is already running never flashes a countdown; the client clock takes over
 * right after. Null without `renderedAt` until hydration.
 */
function useMinute(renderedAt: number | undefined): Date | null {
  const serverMinute = () => (renderedAt === undefined ? null : Math.floor(renderedAt / 60_000));
  const minute = useSyncExternalStore(subscribe, currentMinute, serverMinute);
  return minute === null ? null : new Date(minute * 60_000);
}

type Phase =
  | { kind: "unknown" }
  | { kind: "before"; left: TimeLeft }
  /** `left` is time to the end; null when the sale has no end date. */
  | { kind: "running"; left: TimeLeft | null }
  | { kind: "ended" };

/** Where a sale stands: counting down to its start, then to its end, then over. */
function salePhase(startsAt: string, endsAt: string | null, now: Date | null): Phase {
  if (now === null) return { kind: "unknown" };
  const toStart = timeUntil(new Date(startsAt), now);
  if (toStart) return { kind: "before", left: toStart };
  if (endsAt === null) return { kind: "running", left: null };
  const toEnd = timeUntil(new Date(endsAt), now);
  return toEnd ? { kind: "running", left: toEnd } : { kind: "ended" };
}

interface Action {
  /** "file" is a plain link to a file (the .ics); "more" puts the chevron after the label. */
  kind: "file" | "page" | "more";
  href: string;
  label: string;
  Icon: LucideIcon;
}

interface SaleCountdownProps {
  title: string;
  startsAt: string;
  endsAt: string | null;
  /** When the server rendered the card (ms); see useMinute. */
  renderedAt?: number;
  /** "הזכירו לי" target (the WhatsApp channel card); null hides the button. */
  reminderHref?: string | null;
  /** "הוספה ליומן": the sale's calendar file (app/sales/[id]/ics). */
  calendarHref?: string;
  /** "לכל המבצעים": the sales calendar (/sales), from the home page. */
  moreHref?: string;
  /**
   * SALE_DATES_NOTE under the dates: the owner entered them (CLAUDE.md §1). Default true; /sales
   * passes false, since its intro already says it for the whole page.
   */
  datesNote?: boolean;
  /** Shown under the countdown: the sale's description and coupons on /sales. */
  children?: ReactNode;
}

/**
 * The big-sale card: counts down to the start, and once the sale runs, to its end ("מסתיים
 * בעוד"). Home page and the /sales hero.
 */
export function SaleCountdown({
  title,
  startsAt,
  endsAt,
  renderedAt,
  reminderHref = "/deals#whatsapp",
  calendarHref,
  moreHref,
  datesNote = true,
  children,
}: SaleCountdownProps) {
  const phase = salePhase(startsAt, endsAt, useMinute(renderedAt));
  // Unique per card, so two countdowns on one page never share a heading id.
  const titleId = useId();
  const started = phase.kind === "running" || phase.kind === "ended";
  const left = phase.kind === "before" || phase.kind === "running" ? phase.left : null;

  const units = [
    { value: left?.days, label: "ימים" },
    { value: left?.hours, label: "שעות" },
    { value: left?.minutes, label: "דקות" },
  ];

  // The first action is the primary button. Reminders go out through the WhatsApp channel.
  const actions: Action[] = [];
  if (calendarHref && phase.kind !== "ended") {
    actions.push({ kind: "file", href: calendarHref, label: "הוספה ליומן", Icon: CalendarPlus });
  }
  if (DEALS_ENABLED && reminderHref) {
    actions.push({ kind: "page", href: reminderHref, label: "הזכירו לי", Icon: Bell });
  }
  if (moreHref) {
    actions.push({ kind: "more", href: moreHref, label: "לכל המבצעים", Icon: ChevronLeft });
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-5 rounded-card bg-gold-soft p-6 sm:p-7"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock aria-hidden className="size-[18px]" />
          {phase.kind === "ended"
            ? "מבצע גדול"
            : phase.kind === "running"
              ? "מבצע גדול עכשיו"
              : "המבצע הגדול הבא"}
        </p>
        <h2 id={titleId} className="font-display text-3xl text-ink">
          {title}
        </h2>
        <p className="text-sm text-muted">
          {started ? "התחיל ב־" : "מתחיל ב־"}
          <bdi dir="ltr">{formatShortDate(startsAt)}</bdi>
          {endsAt && (
            <>
              {" "}
              {/* The last day it covers: a sale ending at midnight ends the day before. */}
              ונמשך עד <bdi dir="ltr">{formatShortDate(lastCoveredInstant(endsAt))}</bdi>
            </>
          )}
        </p>
        {datesNote && <p className="text-xs leading-relaxed text-muted">{SALE_DATES_NOTE}</p>}
      </div>

      {phase.kind === "ended" ? (
        <p className="text-lg font-bold">המבצע הסתיים.</p>
      ) : phase.kind === "running" && left === null ? (
        <p className="text-lg font-bold">המבצע כבר התחיל.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">
            {phase.kind === "running" ? "מסתיים בעוד" : "מתחיל בעוד"}
          </p>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {units.map((u) => (
              <div
                key={u.label}
                className="flex flex-col-reverse gap-1.5 rounded-2xl bg-surface px-2 py-3 text-center"
              >
                <dt className="text-xs font-medium text-muted">{u.label}</dt>
                <dd className="text-3xl leading-none font-bold text-ink">
                  {u.value === undefined ? "–" : String(u.value).padStart(2, "0")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {children}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {actions.map(({ kind, href, label, Icon }, i) => {
            const className = `${i === 0 ? btnPrimary : btnSecondary} ${btnMd}`;
            const icon = <Icon aria-hidden className="size-[18px]" />;
            // The calendar file is not a page: a plain link. No `download`: served inline, a phone
            // offers to add the event to its calendar instead of saving a file.
            return kind === "file" ? (
              <a key={href} href={href} rel="nofollow" className={className}>
                {icon}
                {label}
              </a>
            ) : (
              <Link key={href} href={href} className={className}>
                {kind === "more" ? null : icon}
                {label}
                {kind === "more" ? icon : null}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * A one-line countdown for sale cards: "מתחיל בעוד 12 ימים ו־4 שעות", then "מסתיים בעוד 5 שעות
 * ו־20 דקות" (or "פעיל עכשיו" without an end date), then "המבצע הסתיים".
 */
export function SaleTimer({
  startsAt,
  endsAt,
  renderedAt,
}: Pick<SaleCountdownProps, "startsAt" | "endsAt" | "renderedAt">) {
  const phase = salePhase(startsAt, endsAt, useMinute(renderedAt));
  const text =
    phase.kind === "before"
      ? `מתחיל בעוד ${formatTimeLeft(phase.left)}`
      : phase.kind === "running"
        ? phase.left
          ? `מסתיים בעוד ${formatTimeLeft(phase.left)}`
          : "פעיל עכשיו"
        : phase.kind === "ended"
          ? "המבצע הסתיים"
          : null;
  if (text === null) return null;
  return (
    <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-gold px-3 py-1 text-sm font-bold text-on-gold">
      <Timer aria-hidden className="size-4 shrink-0" />
      {text}
    </p>
  );
}
