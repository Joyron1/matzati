import { describe, expect, it } from "vitest";
import { SALE_DATES_NOTE } from "@/lib/copy";
import { escapeText, foldLine, icsUtc, saleCalendarFile } from "./ics";

const NOW = new Date("2026-09-28T08:00:00.000Z");
const OPTIONS = {
  now: NOW,
  host: "matzati-il.vercel.app",
  url: "https://matzati-il.vercel.app/sales",
};
const ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const sale = (over: Partial<Parameters<typeof saleCalendarFile>[0]> = {}) => ({
  id: ID,
  title: "11.11 באלי אקספרס",
  body: "",
  starts_at: "2026-11-10T22:00:00.000Z",
  ends_at: "2026-11-13T21:59:00.000Z",
  ...over,
});

/** Undoes folding (RFC 5545 3.1) and splits into content lines. */
const unfold = (file: string) => file.replace(/\r\n /g, "").split("\r\n");

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma and newlines", () => {
    expect(escapeText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d");
    expect(escapeText("שורה 1\r\nשורה 2\nשורה 3\rסוף")).toBe("שורה 1\\nשורה 2\\nשורה 3\\nסוף");
  });

  it("drops control characters but keeps tabs", () => {
    expect(escapeText("a\u0000b\u0007c\td\u007f")).toBe("abc\td");
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:קצר")).toBe("SUMMARY:קצר");
  });

  it("folds at 75 octets without splitting a character", () => {
    const line = `DESCRIPTION:${"אבגדה".repeat(30)}😀 end`;
    const folded = foldLine(line);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const [i, part] of physical.entries()) {
      expect(utf8Length(part)).toBeLessThanOrEqual(75);
      if (i > 0) expect(part.startsWith(" ")).toBe(true);
    }
    // No piece ends in half an emoji, and unfolding restores the line exactly.
    expect(physical.some((part) => /[\uD800-\uDBFF]$/.test(part))).toBe(false);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    // A 4-octet character that would cross the limit moves to the next line whole.
    const edge = `X:${"a".repeat(72)}`;
    expect(foldLine(`${edge}😀`)).toBe(`${edge}\r\n 😀`);
  });
});

describe("icsUtc", () => {
  it("formats a UTC DATE-TIME", () => {
    expect(icsUtc("2026-11-11T00:00:00+02:00")).toBe("20261110T220000Z");
    expect(icsUtc(NOW)).toBe("20260928T080000Z");
  });
});

describe("saleCalendarFile", () => {
  it("builds one VEVENT with UTC times, a stable UID and CRLF line endings", () => {
    const file = saleCalendarFile(sale(), OPTIONS);
    expect(file.endsWith("\r\n")).toBe(true);
    expect(file.replace(/\r\n/g, "").includes("\n")).toBe(false);
    const lines = unfold(file);
    expect(lines.slice(0, 6)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Matzati//Sales calendar//HE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
    ]);
    expect(lines).toContain(`UID:${ID}@matzati-il.vercel.app`);
    expect(lines).toContain("DTSTAMP:20260928T080000Z");
    expect(lines).toContain("DTSTART:20261110T220000Z");
    expect(lines).toContain("DTEND:20261113T215900Z");
    expect(lines).toContain("SUMMARY:11.11 באלי אקספרס");
    expect(lines).toContain("URL:https://matzati-il.vercel.app/sales");
    expect(lines.slice(-3)).toEqual(["END:VEVENT", "END:VCALENDAR", ""]);
    for (const physical of file.split("\r\n")) {
      expect(utf8Length(physical)).toBeLessThanOrEqual(75);
    }
  });

  it("says where the dates come from, after the body, and escapes it all", () => {
    const file = saleCalendarFile(
      sale({ title: "מבצע; גדול, מאוד", body: "שורה\nשנייה" }),
      OPTIONS,
    );
    const lines = unfold(file);
    expect(lines).toContain("SUMMARY:מבצע\\; גדול\\, מאוד");
    const description = lines.find((l) => l.startsWith("DESCRIPTION:"));
    expect(description).toBe(
      `DESCRIPTION:שורה\\nשנייה\\n\\n${escapeText(SALE_DATES_NOTE)}\\n\\nhttps://matzati-il.vercel.app/sales`,
    );
  });

  it("has no DTEND without an end (or with an end before the start)", () => {
    expect(
      unfold(saleCalendarFile(sale({ ends_at: null }), OPTIONS)).some((l) => l.startsWith("DTEND")),
    ).toBe(false);
    const backwards = sale({ ends_at: "2026-11-01T00:00:00.000Z" });
    expect(unfold(saleCalendarFile(backwards, OPTIONS)).some((l) => l.startsWith("DTEND"))).toBe(
      false,
    );
  });

  it("refuses a sale without a start", () => {
    expect(() => saleCalendarFile(sale({ starts_at: null }), OPTIONS)).toThrow();
  });
});
