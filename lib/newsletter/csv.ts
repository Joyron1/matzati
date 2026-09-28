// The admin's CSV export of active subscribers (/admin/newsletter/export). RFC 4180: every field
// quoted, quotes doubled, CRLF line ends, and a UTF-8 byte order mark so Excel reads the file as
// UTF-8. A cell that starts with = + - @ or a tab or carriage return would run as a formula in a
// spreadsheet; it gets a leading apostrophe (the sign-up form never accepts such an address, so
// this only guards against rows written some other way). Pure.
import { BRAND } from "@/lib/config/brand";
import type { SubscriberRow } from "./db";

export const CSV_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field: neutralized when it could start a formula, then quoted. */
export function csvField(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** One CSV line (without its line end). */
export function csvLine(fields: readonly string[]): string {
  return fields.map(csvField).join(",");
}

const israelParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "2026-09-28T20:00:05Z" → "2026-09-28 23:00:05" (Israel time), which Excel reads as a date. */
export function israelDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = Object.fromEntries(israelParts.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export const CSV_HEADER = [
  "email",
  "subscribed_at_israel_time",
  "source",
  "consent_version",
] as const;

/** The whole file: BOM, header, one line per subscriber, CRLF after every line. */
export function subscribersCsv(rows: readonly SubscriberRow[]): string {
  const lines = [
    csvLine(CSV_HEADER),
    ...rows.map((r) =>
      csvLine([r.email, israelDateTime(r.consentedAt), r.source, r.consentVersion]),
    ),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** "matzati-newsletter-2026-09-28.csv" (the Israel date). ASCII, so every browser keeps it. */
export function csvFileName(now: Date): string {
  const brand = BRAND.nameLatin.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "site";
  return `${brand}-newsletter-${israelDateTime(now.toISOString()).slice(0, 10)}.csv`;
}
