"use client";

import Link from "next/link";
import { Bell, CalendarClock } from "lucide-react";
import { useSyncExternalStore } from "react";
import { formatShortDate, timeUntil } from "@/lib/format";
import { DEALS_ENABLED } from "@/lib/config/site";
import { btnMd, btnPrimary } from "./styles";

// Ticks once per minute; the snapshot is the current minute so renders stay cheap.
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 15_000);
  return () => clearInterval(id);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
const serverMinute = () => null;

interface SaleCountdownProps {
  title: string;
  startsAt: string;
}

export function SaleCountdown({ title, startsAt }: SaleCountdownProps) {
  const minute = useSyncExternalStore(subscribe, currentMinute, serverMinute);
  const left = minute === null ? null : timeUntil(new Date(startsAt), new Date(minute * 60_000));
  const started = minute !== null && left === null;

  const units = [
    { value: left?.days, label: "ימים" },
    { value: left?.hours, label: "שעות" },
    { value: left?.minutes, label: "דקות" },
  ];

  return (
    <section
      aria-labelledby="next-sale-title"
      className="flex flex-col gap-5 rounded-card bg-gold-soft p-6 sm:p-7"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock aria-hidden className="size-[18px]" />
          המבצע הגדול הבא
        </p>
        <h2 id="next-sale-title" className="font-display text-3xl text-ink">
          {title}
        </h2>
        <p className="text-sm text-muted">
          מתחיל ב־<bdi dir="ltr">{formatShortDate(startsAt)}</bdi>
        </p>
      </div>

      {started ? (
        <p className="text-lg font-bold">המבצע כבר התחיל.</p>
      ) : (
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
      )}

      {/* The reminder goes through the WhatsApp channel on /deals, hidden until M5. */}
      {DEALS_ENABLED && (
        <Link href="/deals#whatsapp" className={`${btnPrimary} ${btnMd} self-start`}>
          <Bell aria-hidden className="size-[18px]" />
          הזכירו לי
        </Link>
      )}
    </section>
  );
}
