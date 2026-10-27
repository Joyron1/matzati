// The Meta panel's month calendar (owner request 2026-10-27): every scheduled, published or failed
// item on its Israel day, so the owner sees when each one goes out. Server-rendered links only: a
// day opens its items under the calendar (?day=), the arrows move a month (?month=), and the kind
// filter is kept. On a phone a day shows a colored dot per item; from md small chips with the time.
import Link from "next/link";
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { btnSecondary, btnSm, card } from "@/components/styles";
import {
  dayKeyOf,
  dayLabel,
  HEBREW_MONTHS,
  monthCells,
  monthKey,
  shiftMonth,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  type YearMonth,
} from "@/lib/meta/calendar";
import type { MetaKind, MetaMedia, Reel } from "@/lib/meta/reels-run";
import { toIsraelLocal } from "@/lib/meta/reels-time";
import { byDay, KIND_LABEL, KIND_PLURAL, kindOf, PastItem, ScheduledCard } from "./scheduled";

/** Each kind's colors: a chip, and a dot on a phone. */
export const KIND_TONE: Record<MetaKind, { chip: string; dot: string }> = {
  reel: { chip: "bg-accent-soft text-accent-ink", dot: "bg-accent" },
  post: { chip: "bg-trust-soft text-trust", dot: "bg-trust" },
  story: { chip: "bg-tg-soft text-tg-ink", dot: "bg-tg" },
};

/** Chips a day shows from md before "+N". */
const CHIPS_PER_DAY = 3;
/** Dots a day shows on a phone before "+N". */
const DOTS_PER_DAY = 4;

export interface CalendarLinks {
  /** The panel's path: /admin/meta, or the dev preview's. */
  basePath: string;
  kind: MetaKind | null;
}

/** The panel's address with the calendar's state, landing on the calendar. */
export function calendarHref(
  links: CalendarLinks,
  state: { month?: YearMonth; day?: string | null },
  hash = "calendar",
): string {
  const q = new URLSearchParams();
  if (links.kind) q.set("kind", links.kind);
  if (state.month) q.set("month", monthKey(state.month));
  if (state.day) q.set("day", state.day);
  const query = q.toString();
  return `${links.basePath}${query ? `?${query}` : ""}#${hash}`;
}

/** The items by Israel day, each day by time. */
export function itemsByDayKey(items: Reel[]): Map<string, Reel[]> {
  const days = new Map<string, Reel[]>();
  for (const r of [...items].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
    const key = dayKeyOf(new Date(r.scheduled_at));
    days.set(key, [...(days.get(key) ?? []), r]);
  }
  return days;
}

const timeOf = (r: Reel) => toIsraelLocal(new Date(r.scheduled_at)).slice(11);

function StateIcon({ r }: { r: Reel }) {
  if (r.status === "done") return <CheckCircle2 aria-hidden className="size-3 shrink-0" />;
  if (r.status === "failed" || r.status === "partial")
    return <CircleAlert aria-hidden className="size-3 shrink-0" />;
  return null;
}

function stateWord(r: Reel): string {
  if (r.status === "done") return ", עלה";
  if (r.status === "partial") return ", עלה חלקית";
  if (r.status === "failed") return ", נכשל";
  return "";
}

function Chip({
  r,
  thumb,
}: {
  r: Reel;
  thumb: { file: MetaMedia; url: string | null } | undefined;
}) {
  const kind = kindOf(r);
  const past = r.status !== "scheduled";
  return (
    <li
      className={`flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-[11px] leading-4 font-semibold ${KIND_TONE[kind].chip} ${past ? "opacity-60" : ""}`}
    >
      {thumb?.url && thumb.file.type === "image" && (
        // A signed storage URL: next/image's loader is for AliExpress photos.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb.url} alt="" className="size-5 shrink-0 rounded object-cover" />
      )}
      <bdi dir="ltr" className="shrink-0">
        {timeOf(r)}
      </bdi>
      <span className="truncate">{KIND_LABEL[kind]}</span>
      <StateIcon r={r} />
    </li>
  );
}

export function MetaCalendar({
  items,
  month,
  today,
  selected,
  links,
  previews,
}: {
  /** Every item to place (cancelled ones are left out here). */
  items: Reel[];
  month: YearMonth;
  /** Today's Israel day key. */
  today: string;
  selected: string | null;
  links: CalendarLinks;
  previews: Previews;
}) {
  const days = itemsByDayKey(items.filter((r) => r.status !== "cancelled"));
  const cells = monthCells(month);
  const inMonth = [...days.entries()].filter(([key]) => key.startsWith(monthKey(month)));
  const count = inMonth.reduce((n, [, list]) => n + list.length, 0);
  const title = `${HEBREW_MONTHS[month.month - 1]} ${month.year}`;
  const nav =
    "grid size-11 place-items-center rounded-full border border-line text-ink hover:bg-surface-2";

  return (
    <div className={`${card} space-y-3 p-3 sm:p-5`}>
      <div className="flex items-center justify-between gap-2">
        <Link
          href={calendarHref(links, { month: shiftMonth(month, -1) })}
          scroll={false}
          aria-label="החודש הקודם"
          className={nav}
        >
          <ChevronRight aria-hidden className="size-5" />
        </Link>
        <div className="text-center">
          <h3 className="text-lg font-bold" aria-live="polite">
            {title}
          </h3>
          <p className="text-xs text-muted">
            {count ? `${count} פריטים בחודש` : "אין פריטים בחודש הזה"}
            {" · "}
            <Link
              href={calendarHref(links, { day: today }, "day")}
              className="font-semibold text-accent-ink underline-offset-2 hover:underline"
            >
              היום
            </Link>
          </p>
        </div>
        <Link
          href={calendarHref(links, { month: shiftMonth(month, 1) })}
          scroll={false}
          aria-label="החודש הבא"
          className={nav}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
      </div>

      <div className="space-y-1">
        {/* The weekday names are in every day's own label. */}
        <div aria-hidden className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((name, i) => (
            <div key={name} className="py-1 text-center text-xs font-bold text-muted">
              <span className="md:hidden">{WEEKDAYS_SHORT[i]}</span>
              <span className="hidden md:inline">{name}</span>
            </div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, w) => (
          <ul key={w} className="grid grid-cols-7 gap-1">
            {cells.slice(w * 7, w * 7 + 7).map((key, i) => {
              if (!key) return <li key={`e${w}-${i}`} aria-hidden />;
              const list = days.get(key) ?? [];
              const isToday = key === today;
              const isSelected = key === selected;
              const isPast = key < today;
              const label = `${dayLabel(key)}${isToday ? ", היום" : ""}${isSelected ? ", פתוח למטה" : ""}: ${
                list.length
                  ? list
                      .map((r) => `${KIND_LABEL[kindOf(r)]} ${timeOf(r)}${stateWord(r)}`)
                      .join(", ")
                  : "אין פריטים"
              }`;
              return (
                <li key={key}>
                  <Link
                    href={calendarHref(links, { month, day: key }, "day")}
                    aria-label={label}
                    aria-current={isToday ? "date" : undefined}
                    className={`flex h-full min-h-14 flex-col gap-1 rounded-lg border p-1 transition-colors md:min-h-28 md:p-1.5 ${
                      isSelected
                        ? "border-accent ring-2 ring-accent/30"
                        : "border-line hover:border-muted"
                    } ${isPast ? "bg-surface-2/60" : "bg-surface"}`}
                  >
                    <span
                      className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                        isToday ? "bg-accent text-on-accent" : isPast ? "text-muted" : "text-ink"
                      }`}
                    >
                      {Number(key.slice(8))}
                    </span>
                    {list.length > 0 && (
                      <>
                        <span className="flex flex-wrap gap-0.5 px-0.5 md:hidden">
                          {list.slice(0, DOTS_PER_DAY).map((r) => (
                            <span
                              key={r.id}
                              className={`size-2 rounded-full ${KIND_TONE[kindOf(r)].dot} ${r.status !== "scheduled" ? "opacity-50" : ""}`}
                            />
                          ))}
                          {list.length > DOTS_PER_DAY && (
                            <span className="text-[10px] leading-2 font-bold text-muted">
                              +{list.length - DOTS_PER_DAY}
                            </span>
                          )}
                        </span>
                        <ul className="hidden min-w-0 flex-col gap-1 md:flex">
                          {list.slice(0, CHIPS_PER_DAY).map((r) => (
                            <Chip key={r.id} r={r} thumb={previews.get(r.id)?.[0]} />
                          ))}
                          {list.length > CHIPS_PER_DAY && (
                            <li className="px-1 text-[11px] font-semibold text-muted">
                              +{list.length - CHIPS_PER_DAY} עוד
                            </li>
                          )}
                        </ul>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {(["reel", "post", "story"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${KIND_TONE[k].dot}`} />
            {KIND_LABEL[k]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <CheckCircle2 aria-hidden className="size-3.5" />
          עלה
        </li>
        <li className="flex items-center gap-1.5">
          <CircleAlert aria-hidden className="size-3.5" />
          נכשל
        </li>
        <li>לחצו על יום כדי לראות את הפריטים שלו.</li>
      </ul>
    </div>
  );
}
type Previews = Map<string, { file: MetaMedia; url: string | null }[]>;

/**
 * Under the calendar: the chosen day's items (scheduled ones as cards, the others as rows), or,
 * with no day chosen, every scheduled item by day.
 */
export function DayAgenda({
  day,
  items,
  shown,
  kindFilter,
  allHref,
  previews,
}: {
  day: string | null;
  items: Reel[];
  shown: Reel[];
  kindFilter: MetaKind | null;
  allHref: string;
  previews: Previews;
}) {
  if (day) {
    const scheduled = items.filter((r) => r.status === "scheduled");
    const others = items.filter((r) => r.status !== "scheduled");
    return (
      <section id="day" aria-labelledby="day-title" className="scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="day-title" className="flex items-center gap-2 text-lg font-bold">
            <CalendarClock aria-hidden className="size-5 text-accent" />
            {dayLabel(day)}
          </h3>
          <Link href={allHref} className={`${btnSecondary} ${btnSm}`}>
            לכל המתוזמנים
          </Link>
        </div>
        {!items.length ? (
          <p className={`${card} p-5 text-muted`}>
            {kindFilter ? `אין ${KIND_PLURAL[kindFilter]} ביום הזה.` : "אין פריטים ביום הזה."}
          </p>
        ) : (
          <>
            {scheduled.length > 0 && (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {scheduled.map((r) => (
                  <ScheduledCard key={r.id} r={r} previews={previews.get(r.id) ?? []} />
                ))}
              </ul>
            )}
            {others.length > 0 && (
              <ul className={`${card} divide-y divide-line`}>
                {others.map((r) => (
                  <PastItem key={r.id} r={r} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    );
  }
  return (
    <section id="day" aria-labelledby="all-title" className="scroll-mt-20 space-y-4">
      <h3 id="all-title" className="text-lg font-bold">
        כל המתוזמנים
      </h3>
      {!shown.length ? (
        <p className={`${card} p-5 text-muted`}>
          {kindFilter ? `אין ${KIND_PLURAL[kindFilter]} מתוזמנים.` : "אין כרגע תוכן מתוזמן."}
        </p>
      ) : (
        <div className="space-y-6">
          {byDay(shown).map(([label, list]) => (
            <section key={label} aria-label={label} className="space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-bold text-muted">
                <CalendarClock aria-hidden className="size-4" />
                {label}
                <span className="h-px flex-1 bg-line" />
              </h4>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <ScheduledCard key={r.id} r={r} previews={previews.get(r.id) ?? []} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
