import { describe, expect, it } from "vitest";
import {
  formatIlsAmount,
  formatIsraelDay,
  formatShare,
  formatUsd,
  llmKindLabel,
  NO_SHARE,
} from "./format";

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
