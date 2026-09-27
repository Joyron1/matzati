// Deal date rules, plus Asia/Jerusalem conversions for the admin form's datetime-local inputs.
// Pure: safe for server code, client components and tests.
import type { Deal } from "@/lib/types";

const TIME_ZONE = "Asia/Jerusalem";

type Window = Pick<Deal, "starts_at" | "ends_at">;

/** Ended once ends_at is reached. No ends_at means it never ends on its own. */
export function hasEnded(deal: Window, now: Date): boolean {
  return deal.ends_at !== null && Date.parse(deal.ends_at) <= now.getTime();
}

/** Started once starts_at is reached. No starts_at means it runs from the moment it is published. */
export function hasStarted(deal: Window, now: Date): boolean {
  return deal.starts_at === null || Date.parse(deal.starts_at) <= now.getTime();
}

/** Running right now: started and not ended. */
export function isCurrent(deal: Window, now: Date): boolean {
  return hasStarted(deal, now) && !hasEnded(deal, now);
}

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

function wallClock(ms: number) {
  const p = Object.fromEntries(
    zoneParts.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]),
  );
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** Israel's UTC offset in ms at instant `ms`. */
function offsetAt(ms: number): number {
  const w = wallClock(ms);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

/**
 * A datetime-local value ("2026-11-11T00:00") read as Israel wall-clock time, as an ISO instant.
 * Null when the value is not a real date and time. In the spring-forward gap (a wall time that
 * does not exist in Israel) the result lands an hour later, which is what the admin meant.
 */
export function israelLocalToIso(value: string): string | null {
  const m = LOCAL_INPUT.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, min, s] = m.slice(1).map((v) => Number(v ?? 0));
  const naive = Date.UTC(y, mo - 1, d, h, min, s);
  const check = new Date(naive);
  // Rejects 2026-02-30, 25:00 and the like, which Date.UTC would silently roll over.
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== min ||
    check.getUTCSeconds() !== s
  ) {
    return null;
  }
  const guess = naive - offsetAt(naive);
  return new Date(naive - offsetAt(guess)).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO instant as a datetime-local value in Israel time ("2026-11-11T00:00"); "" for none. */
export function isoToIsraelLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const w = wallClock(ms);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.min)}`;
}
