import { describe, expect, it } from "vitest";
import { cleanRecentText, parseRecentParams, recentHref } from "./params";
import { OTHER_CATEGORY, RECENT_MAX_PAGES, RECENT_TEXT_MAX } from "./types";

describe("parseRecentParams", () => {
  it("defaults to page 1 with no filters", () => {
    expect(parseRecentParams({})).toEqual({ page: 1 });
  });

  it("reads a category id, text and page", () => {
    expect(parseRecentParams({ cat: "44", q: "אוזניות", page: "3" })).toEqual({
      category: "44",
      text: "אוזניות",
      page: 3,
    });
  });

  it("accepts the other bucket and drops any other category value", () => {
    expect(parseRecentParams({ cat: OTHER_CATEGORY }).category).toBe(OTHER_CATEGORY);
    for (const cat of ["", "abc", "4 4", "-1", "1.5", "1234567890123", " 44", "Other"]) {
      expect(parseRecentParams({ cat })).toEqual({ page: 1 });
    }
    expect(parseRecentParams({ cat: "123456789012" }).category).toBe("123456789012");
  });

  it("trims and collapses the text, cuts it at RECENT_TEXT_MAX and drops it when empty", () => {
    expect(parseRecentParams({ q: "  אוזניות \n  לריצה  " }).text).toBe("אוזניות לריצה");
    expect(parseRecentParams({ q: "   " })).toEqual({ page: 1 });
    const long = parseRecentParams({ q: "א".repeat(RECENT_TEXT_MAX + 20) }).text;
    expect(long).toHaveLength(RECENT_TEXT_MAX);
  });

  it("clamps the page to 1..RECENT_MAX_PAGES and ignores anything that is not a whole number", () => {
    expect(parseRecentParams({ page: "0" }).page).toBe(1);
    expect(parseRecentParams({ page: "99" }).page).toBe(RECENT_MAX_PAGES);
    expect(parseRecentParams({ page: "99999999999999999999999" }).page).toBe(RECENT_MAX_PAGES);
    for (const page of ["-2", "2.5", "abc", "", "1e3", " 2"]) {
      expect(parseRecentParams({ page }).page).toBe(1);
    }
  });

  it("takes the first value of a repeated param", () => {
    expect(parseRecentParams({ cat: ["44", "26"], q: ["a b", "c"], page: ["2", "5"] })).toEqual({
      category: "44",
      text: "a b",
      page: 2,
    });
  });

  it("reads own keys only", () => {
    const params = Object.create({ cat: "44", q: "inherited" }) as Record<string, string>;
    expect(parseRecentParams(params)).toEqual({ page: 1 });
  });
});

describe("cleanRecentText", () => {
  it("never splits a character made of two code units", () => {
    const text = cleanRecentText(`${"א".repeat(RECENT_TEXT_MAX - 1)}😀😀`);
    expect(Array.from(text ?? "")).toHaveLength(RECENT_TEXT_MAX);
    expect(text?.endsWith("😀")).toBe(true);
  });

  it("does not leave a trailing space after the cut", () => {
    expect(cleanRecentText(`${"א".repeat(RECENT_TEXT_MAX - 1)} ב`)).toBe(
      "א".repeat(RECENT_TEXT_MAX - 1),
    );
  });
});

describe("recentHref", () => {
  it("is the bare path without filters or on page 1", () => {
    expect(recentHref({})).toBe("/searches");
    expect(recentHref({ page: 1 })).toBe("/searches");
    expect(recentHref({ category: "", text: "  ", page: 1 })).toBe("/searches");
  });

  it("builds cat, q and page in that order", () => {
    expect(recentHref({ category: "44", text: "אוזניות", page: 2 })).toBe(
      `/searches?cat=44&q=${encodeURIComponent("אוזניות")}&page=2`,
    );
    expect(recentHref({ category: OTHER_CATEGORY })).toBe("/searches?cat=other");
  });

  it("encodes the text so it round-trips through parseRecentParams", () => {
    const filter = { category: "26", text: 'כבל USB-C & "מהיר" 2 מטר?', page: 4 };
    const url = new URL(recentHref(filter), "https://example.test");
    expect(parseRecentParams(Object.fromEntries(url.searchParams))).toEqual(filter);
  });

  it("drops invalid values and caps the page", () => {
    expect(recentHref({ category: "abc", page: 0 })).toBe("/searches");
    expect(recentHref({ page: 2.5 })).toBe("/searches");
    expect(recentHref({ page: 50 })).toBe(`/searches?page=${RECENT_MAX_PAGES}`);
  });
});
