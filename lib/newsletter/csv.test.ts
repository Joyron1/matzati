import { describe, expect, it } from "vitest";
import { CSV_BOM, csvField, csvFileName, csvLine, israelDateTime, subscribersCsv } from "./csv";

describe("csvField", () => {
  it("quotes every field and doubles quotes", () => {
    expect(csvField("dana@example.com")).toBe('"dana@example.com"');
    expect(csvField("")).toBe('""');
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvField('"')).toBe('""""');
  });

  it("keeps commas and line breaks inside the quotes", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField("a\r\nb\nc")).toBe('"a\r\nb\nc"');
  });

  it("neutralizes a cell that would start a formula", () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvField("+1")).toBe('"\'+1"');
    expect(csvField("-2+3")).toBe('"\'-2+3"');
    expect(csvField("@SUM(A1)")).toBe('"\'@SUM(A1)"');
    expect(csvField("\tx")).toBe('"\'\tx"');
    expect(csvField("\rx")).toBe('"\'\rx"');
    // Only at the start.
    expect(csvField("a=b")).toBe('"a=b"');
    expect(csvField("dana+deals@example.com")).toBe('"dana+deals@example.com"');
  });

  it("joins a line with commas", () => {
    expect(csvLine(["a", 'b"c', "d,e"])).toBe('"a","b""c","d,e"');
  });
});

describe("israelDateTime", () => {
  it("prints Israel time, summer and winter", () => {
    expect(israelDateTime("2026-09-28T20:00:05Z")).toBe("2026-09-28 23:00:05"); // IDT, +3
    expect(israelDateTime("2026-12-31T22:30:00Z")).toBe("2027-01-01 00:30:00"); // IST, +2
    expect(israelDateTime("not a date")).toBe("");
  });
});

describe("subscribersCsv", () => {
  it("is a BOM, a header and one CRLF-ended line per subscriber", () => {
    const csv = subscribersCsv([
      {
        email: "dana@example.com",
        consentedAt: "2026-09-28T20:00:05.123Z",
        source: "footer",
        consentVersion: "2026-09-28",
      },
      {
        email: "=evil@example.com",
        consentedAt: "2026-09-29T06:00:00Z",
        source: "footer",
        consentVersion: "2026-09-28",
      },
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(
      [
        '"email","subscribed_at_israel_time","source","consent_version"',
        '"dana@example.com","2026-09-28 23:00:05","footer","2026-09-28"',
        '"\'=evil@example.com","2026-09-29 09:00:00","footer","2026-09-28"',
        "",
      ].join("\r\n"),
    );
  });

  it("is the header alone with no subscribers", () => {
    expect(subscribersCsv([])).toBe(
      `${CSV_BOM}"email","subscribed_at_israel_time","source","consent_version"\r\n`,
    );
  });

  it("encodes as UTF-8 with the BOM bytes first", () => {
    const bytes = new TextEncoder().encode(subscribersCsv([]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("csvFileName", () => {
  it("names the Israel date in ASCII", () => {
    expect(csvFileName(new Date("2026-09-28T22:30:00Z"))).toBe("matzati-newsletter-2026-09-29.csv");
  });
});
