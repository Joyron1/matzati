// "הוספה ליומן" on /sales: one sale as an RFC 5545 calendar file with a single VEVENT. Pure, so
// the escaping and line folding are unit-tested; app/sales/[id]/ics/route.ts serves it.
// Every event carries SALE_DATES_NOTE: the dates are ours, not an AliExpress feed.
import { SALE_DATES_NOTE } from "@/lib/copy";
import type { Deal } from "@/lib/types";

const CRLF = "\r\n";
/** RFC 5545 3.1: lines longer than 75 octets are folded. */
const MAX_OCTETS = 75;

/** Tab and printable characters; TEXT values may not hold other control characters. */
const allowed = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code === 0x09 || (code >= 0x20 && code !== 0x7f);
};

/** TEXT value escaping (RFC 5545 3.3.11); other control characters are dropped. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      Array.from(line)
        .filter(allowed)
        .join("")
        .replace(/[\\;,]/g, (c) => `\\${c}`),
    )
    .join("\\n");
}

const utf8 = new TextEncoder();

/**
 * Folds a content line into lines of at most 75 octets, each continuation starting with a
 * space. Splits only between characters, so a Hebrew letter (2 octets in UTF-8) or an emoji is
 * never cut in half.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = utf8.encode(char).length;
    // Continuation lines spend one octet on the leading space.
    const limit = parts.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** An instant as a UTC DATE-TIME: "20261110T220000Z". */
export function icsUtc(instant: string | Date): string {
  const iso = (typeof instant === "string" ? new Date(instant) : instant).toISOString();
  return `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;
}

export interface SaleEventOptions {
  /** Generation time (DTSTAMP). */
  now: Date;
  /** The site's host, for a globally unique UID: "<deal id>@<host>". */
  host: string;
  /** Our page for the sale (/sales on the site). */
  url: string;
}

/**
 * A calendar file for one sale. DTSTART/DTEND are UTC instants, so every calendar app shows them
 * in the reader's own time zone. A sale without ends_at gets no DTEND (a reminder at the start,
 * not a guessed length). Throws when the sale has no valid starts_at.
 */
export function saleCalendarFile(
  sale: Pick<Deal, "id" | "title" | "body" | "starts_at" | "ends_at">,
  { now, host, url }: SaleEventOptions,
): string {
  const start = sale.starts_at ? Date.parse(sale.starts_at) : NaN;
  if (!Number.isFinite(start)) throw new Error(`sale ${sale.id} has no start time`);
  const end = sale.ends_at ? Date.parse(sale.ends_at) : NaN;
  const description = [sale.body.trim(), SALE_DATES_NOTE, url].filter(Boolean).join("\n\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Matzati//Sales calendar//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${sale.id}@${host}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(new Date(start))}`,
    ...(Number.isFinite(end) && end > start ? [`DTEND:${icsUtc(new Date(end))}`] : []),
    `SUMMARY:${escapeText(sale.title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${url}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
