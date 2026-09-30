import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESULTS_FIRST_VIEW, RESULTS_PER_PAGE } from "@/lib/config/site";
import { SEARCH_ORIGINS } from "@/lib/search/store";
import {
  clickPositionLabel,
  failureLabel,
  formatIlsAmount,
  formatIsraelDay,
  formatSeconds,
  formatShare,
  formatUsd,
  llmKindLabel,
  NO_SHARE,
  originLabel,
} from "./format";
import { CLICK_POSITION_GROUPS } from "./report";

describe("formatUsd", () => {
  it("keeps fractions of a cent visible for small amounts", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0014)).toBe("$0.0014");
    expect(formatUsd(0.28)).toBe("$0.28");
  });

  it("rounds to cents from one dollar", () => {
    expect(formatUsd(12.3456)).toBe("$12.35");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("formatIlsAmount", () => {
  it("shows shekels with agorot", () => {
    expect(formatIlsAmount(4.5)).toBe("₪4.50");
    expect(formatIlsAmount(1234.567)).toBe("₪1,234.57");
  });
});

describe("formatShare", () => {
  it("shows a percentage with at most one decimal", () => {
    expect(formatShare(0.125)).toBe("12.5%");
    expect(formatShare(1)).toBe("100%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(1 / 3)).toBe("33.3%");
  });

  it("says there is nothing to divide by instead of showing 0%", () => {
    expect(formatShare(null)).toBe(NO_SHARE);
    expect(formatShare(Number.NaN)).toBe(NO_SHARE);
  });
});

describe("formatIsraelDay", () => {
  it("formats the Israel date as is, with its weekday", () => {
    expect(formatIsraelDay("2026-09-27")).toBe("יום א׳, 27.9");
    expect(formatIsraelDay("2026-10-02")).toBe("יום ו׳, 2.10");
  });

  it("returns anything unexpected unchanged", () => {
    expect(formatIsraelDay("soon")).toBe("soon");
  });
});

describe("llmKindLabel", () => {
  it("names every job in Hebrew", () => {
    expect(llmKindLabel("parse")).toBe("הבנת החיפוש");
    expect(llmKindLabel("tips")).toBe("טיפים לקטגוריה");
  });
});

describe("formatSeconds", () => {
  it("shows seconds with one decimal, and a missing median as NO_SHARE", () => {
    expect(formatSeconds(6240)).toBe("6.2 שניות");
    expect(formatSeconds(380)).toBe("0.4 שניות");
    expect(formatSeconds(null)).toBe(NO_SHARE);
  });
});

describe("origin, failure and click position labels", () => {
  const hebrew = /[א-ת]/;

  it("names every origin in Hebrew, and the total row", () => {
    for (const origin of SEARCH_ORIGINS) expect(originLabel(origin)).toMatch(hebrew);
    expect(originLabel(null)).toBe("סה״כ");
  });

  it("names the known failure codes, and leaves an unknown one to be shown as is", () => {
    expect(failureLabel("parse_failed")).toBe("החיפוש לא הובן");
    expect(failureLabel("capacity")).toBe("תקציב ה־LLM היומי נוצל");
    expect(failureLabel("brand_new")).toBeNull();
    expect(failureLabel("toString")).toBeNull();
  });

  it("names every click position group", () => {
    for (const group of CLICK_POSITION_GROUPS) expect(clickPositionLabel(group)).toMatch(hebrew);
    expect(clickPositionLabel("first_page")).toContain(`2 עד ${RESULTS_PER_PAGE}`);
    expect(clickPositionLabel("first_view")).toContain(
      `מקומות ${RESULTS_PER_PAGE + 1} עד ${RESULTS_FIRST_VIEW}`,
    );
    expect(clickPositionLabel("more_pages")).toContain(`מקום ${RESULTS_FIRST_VIEW + 1} ומעלה`);
  });

  it("names the titles call among the LLM jobs", () => {
    expect(llmKindLabel("titles")).toContain(`${RESULTS_PER_PAGE + 1} עד ${RESULTS_FIRST_VIEW}`);
  });

  it("labels the bounds the latest stats_click_positions migration groups by", () => {
    // The newest migration that (re)defines the function is the one the database runs.
    const dir = "supabase/migrations";
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .filter((sql) => sql.includes("function public.stats_click_positions("))
      .at(-1)!;
    expect(latest).toContain("when k.position = 1 then 'featured'");
    expect(latest).toContain(`when k.position between 2 and ${RESULTS_PER_PAGE} then 'first_page'`);
    expect(latest).toContain(
      `when k.position between ${RESULTS_PER_PAGE + 1} and ${RESULTS_FIRST_VIEW} then 'first_view'`,
    );
    for (const group of CLICK_POSITION_GROUPS) expect(latest).toContain(`'${group}'`);
  });
});
