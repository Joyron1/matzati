import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AFFILIATE_NOTE } from "@/lib/copy";
import { CACHE_TTL_DAYS } from "@/lib/search/cache-key";
import {
  ACCESSIBILITY_CHECKED_AT,
  AFFILIATE_SECTION_ID,
  LEGAL,
  LEGAL_PATHS,
  LEGAL_UPDATED_AT,
  REQUIRED_LEGAL_FIELDS,
  RETENTION,
  accessibilityEmail,
  formatLegalDate,
  missingLegalFields,
  type LegalDetails,
} from "./legal";

const EMPTY: LegalDetails = {
  operatorName: "",
  operatorBusinessId: "",
  contactEmail: "",
  accessibilityCoordinatorName: "",
  accessibilityCoordinatorPhone: "",
  accessibilityCoordinatorEmail: "",
};

// The owner details the legal pages still show as "to fill" markers. Each one is a todo in the
// test report until the owner fills it in lib/config/legal.ts; none of them fails the run.
describe("owner details still missing on the legal pages", () => {
  const missing = missingLegalFields();
  if (missing.length === 0) {
    it("none: every required detail is filled", () => expect(missing).toEqual([]));
  }
  for (const field of missing) it.todo(`fill LEGAL.${field} in lib/config/legal.ts`);
});

describe("missingLegalFields", () => {
  it("lists the empty required fields in order, blanks count as empty", () => {
    expect(missingLegalFields(EMPTY)).toEqual([...REQUIRED_LEGAL_FIELDS]);
    expect(
      missingLegalFields({ ...EMPTY, operatorName: "  ", contactEmail: "hello@example.com" }),
    ).toEqual(["operatorName", "accessibilityCoordinatorName", "accessibilityCoordinatorPhone"]);
  });

  it("ignores the optional fields", () => {
    const filled: LegalDetails = {
      ...EMPTY,
      operatorName: "מפעיל לדוגמה",
      contactEmail: "hello@example.com",
      accessibilityCoordinatorName: "רכז לדוגמה",
      accessibilityCoordinatorPhone: "03-0000000",
    };
    expect(missingLegalFields(filled)).toEqual([]);
  });
});

describe("the filled details are well formed", () => {
  it("emails look like addresses", () => {
    for (const email of [LEGAL.contactEmail, LEGAL.accessibilityCoordinatorEmail]) {
      if (email.trim()) expect(email.trim()).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }
  });

  it("the phone has digits to dial", () => {
    const phone = LEGAL.accessibilityCoordinatorPhone.trim();
    if (phone) expect(phone.replace(/[^\d]/g, "").length).toBeGreaterThanOrEqual(9);
  });
});

describe("accessibilityEmail", () => {
  it("prefers the coordinator's own address, else the general contact", () => {
    expect(accessibilityEmail({ ...EMPTY, contactEmail: "a@example.com" })).toBe("a@example.com");
    expect(
      accessibilityEmail({
        ...EMPTY,
        contactEmail: "a@example.com",
        accessibilityCoordinatorEmail: " b@example.com ",
      }),
    ).toBe("b@example.com");
    expect(accessibilityEmail(EMPTY)).toBe("");
  });
});

describe("dates", () => {
  it("formats a day in Hebrew", () => {
    expect(formatLegalDate("2026-09-28")).toBe("28 בספטמבר 2026");
  });

  it("rejects anything but a real YYYY-MM-DD day", () => {
    expect(() => formatLegalDate("2026-9-28")).toThrow();
    expect(() => formatLegalDate("2026-02-30")).toThrow();
    expect(() => formatLegalDate("")).toThrow();
  });

  it("every page date and the last check are real days, not in the future", () => {
    // Tomorrow in UTC, so an Israel date written just after midnight still passes.
    const latest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const day of [...Object.values(LEGAL_UPDATED_AT), ACCESSIBILITY_CHECKED_AT]) {
      expect(() => formatLegalDate(day)).not.toThrow();
      expect(day <= latest).toBe(true);
    }
  });
});

// /privacy states RETENTION; public.run_retention() is what deletes. They are written by hand in
// two places, so the periods are read back from the migration here.
describe("the retention periods /privacy states match the retention migration", () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL("../../supabase/migrations/20260928200000_retention.sql", import.meta.url),
    ),
    "utf8",
  );
  // v_<name>_before constant timestamptz := v_now - interval '<n> <unit>';
  const cutoffs = new Map(
    [
      ...sql.matchAll(
        /v_(\w+)_before constant timestamptz := v_now - interval '(\d+) (hours|days|months)'/g,
      ),
    ].map(([, name, n, unit]) => [name, `${n} ${unit}`]),
  );
  // The cutoff variable each table's delete compares with, by its date column.
  const cutoffOf = (table: string, column: string) => {
    const m = new RegExp(
      `from public\\.${table} \\w+\\s+where \\w+\\.${column} < v_(\\w+)_before`,
    ).exec(sql);
    return m ? cutoffs.get(m[1]) : undefined;
  };

  it("search_log, clicks and hidden searches", () => {
    expect(cutoffOf("search_log", "created_at")).toBe(`${RETENTION.searchLogMonths} months`);
    expect(cutoffOf("clicks", "created_at")).toBe(`${RETENTION.clicksMonths} months`);
    expect(cutoffOf("hidden_searches", "hidden_at")).toBe(`${RETENTION.hiddenSearchMonths} months`);
    // A hidden query goes only once no search_log row has it any more.
    expect(sql).toMatch(
      /not exists \(\s*select 1 from public\.search_log l where l\.query_norm = h\.query_norm/,
    );
  });

  it("the caches, the LLM usage and the price history", () => {
    expect(cutoffOf("parse_cache", "created_at")).toBe(`${RETENTION.cacheRowDays} days`);
    expect(cutoffOf("search_cache", "created_at")).toBe(`${RETENTION.cacheRowDays} days`);
    expect(cutoffOf("llm_usage", "created_at")).toBe(`${RETENTION.usageAndPricesMonths} months`);
    expect(cutoffOf("price_history", "captured_at")).toBe(
      `${RETENTION.usageAndPricesMonths} months`,
    );
  });

  it("rate-limit windows, counted from the window's end", () => {
    expect(cutoffs.get("window_ended")).toBe(`${RETENTION.rateLimitHours} hours`);
    expect(sql).toMatch(/end\s*\)\s*< v_window_ended_before/);
  });

  it("a cache row is deleted only after it can no longer be used", () => {
    // /privacy: "משמש עד CACHE_TTL_DAYS יום, ונמחק cacheRowDays יום אחרי שנוצר".
    expect(RETENTION.cacheRowDays).toBeGreaterThan(CACHE_TTL_DAYS);
  });
});

describe("the affiliate note", () => {
  it("links to the disclosure section of the terms", () => {
    expect(AFFILIATE_NOTE.href).toBe(`${LEGAL_PATHS.terms}#${AFFILIATE_SECTION_ID}`);
  });

  it("its accessible name contains the visible words", () => {
    expect(AFFILIATE_NOTE.ariaLabel).toContain(AFFILIATE_NOTE.label);
  });
});
