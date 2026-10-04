"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useSyncExternalStore } from "react";
import { SALE_DATES_NOTE, SALE_DATES_SHORT } from "@/lib/copy";
import { countdown, countdownText, pickBarSale, type BarSale } from "@/lib/deals/sale-bar";

// One tick a second while the bar is on screen; the snapshot is the current second, so a render
// happens only when a digit changes.
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}
const currentSecond = () => Math.floor(Date.now() / 1000);
const serverSecond = () => null;

/** Never on the admin or the dev previews. */
const HIDDEN_ON = /^\/(?:admin|dev)(?:\/|$)/;

const pad = (n: number) => String(n).padStart(2, "0");

interface SaleBarProps {
  sales: BarSale[];
  /** When the server read the sales (ms): its clock until the browser's takes over. */
  checkedAt: number;
}

/**
 * The top bar for a big sale (owner request 2026-10-04): a running sale counts down to its end,
 * one starting within SALE_BAR_WINDOW_DAYS to its start, and the whole bar links to /sales. The
 * server HTML holds the bar with dashes in place of the digits (its clock may be old), so the
 * page does not move when the browser fills them in; a sale the browser finds ended hides it.
 * The digits are hidden from screen readers, which get the time left in words instead, updated
 * without a live region so nothing is announced every second.
 */
export function SaleBar({ sales, checkedAt }: SaleBarProps) {
  const pathname = usePathname();
  const second = useSyncExternalStore(subscribe, currentSecond, serverSecond);
  const live = second !== null;
  const now = live ? second * 1000 : checkedAt;
  const pick = pickBarSale(sales, now);
  if (!pick || HIDDEN_ON.test(pathname)) return null;

  const { sale, running } = pick;
  const target = running
    ? sale.ends_at === null
      ? null
      : Date.parse(sale.ends_at)
    : Date.parse(sale.starts_at);
  const left = target === null ? null : countdown(target, now);
  const lead = running ? "מסתיים בעוד" : "מתחיל בעוד";
  const cells = left
    ? [
        { value: left.days, label: "ימים" },
        { value: left.hours, label: "שעות" },
        { value: left.minutes, label: "דקות" },
        { value: left.seconds, label: "שניות" },
      ]
    : [];

  return (
    <div className="relative bg-linear-to-l from-(--promo-from) to-(--promo-to) text-promo-ink">
      <Link
        href="/sales"
        className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 py-2 focus-visible:outline-offset-[-3px] sm:gap-4"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-gold px-2.5 py-1 text-xs font-bold text-on-gold sm:inline-flex">
            <Sparkles aria-hidden className="size-3.5" />
            {running ? "עכשיו במבצע" : "המבצע הגדול הבא"}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold sm:text-base">{sale.title}</span>
            {/* Below md the timer has no words beside it: they go under the title. */}
            {left && (
              <span aria-hidden className="truncate text-xs text-promo-muted md:hidden">
                {lead}
              </span>
            )}
            <span
              className="hidden truncate text-xs text-promo-muted lg:block"
              title={SALE_DATES_NOTE}
            >
              {SALE_DATES_SHORT}
            </span>
          </span>
        </span>

        {left ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs font-semibold text-promo-muted md:inline">{lead}</span>
            <span className="sr-only">
              {lead} {live ? countdownText(left) : ""}. {SALE_DATES_NOTE}
            </span>
            <span aria-hidden className="flex items-center gap-1 sm:gap-1.5">
              {cells.map((c, i) => (
                // Seconds from sm: on a phone the title needs the room.
                <span
                  key={c.label}
                  className={`items-center gap-1 sm:gap-1.5 ${i === 3 ? "hidden sm:flex" : "flex"}`}
                >
                  {i > 0 && <span className="text-sm font-bold text-gold">:</span>}
                  <span className="flex min-w-9 flex-col items-center rounded-lg bg-promo-cell px-1.5 py-1 ring-1 ring-promo-line sm:min-w-11">
                    <span className="text-base leading-none font-bold tabular-nums sm:text-lg">
                      {live ? pad(c.value) : "––"}
                    </span>
                    <span className="mt-0.5 text-[10px] leading-none text-promo-muted">
                      {c.label}
                    </span>
                  </span>
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span className="shrink-0 text-sm font-semibold text-gold">
            פעיל עכשיו<span className="sr-only">. {SALE_DATES_NOTE}</span>
          </span>
        )}

        <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold sm:inline-flex">
          לפרטים
          <ChevronLeft aria-hidden className="size-4" />
        </span>
      </Link>
      {/* A gold hairline under the bar. */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-linear-to-l from-transparent via-gold/70 to-transparent"
      />
    </div>
  );
}
