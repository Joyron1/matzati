import { describe, expect, it } from "vitest";
import {
  isValidSlug,
  normalizeSlugInput,
  parseSlugParam,
  SLUG_MAX_LENGTH,
  seoPath,
  slugFromQuery,
} from "./slug";

describe("slugFromQuery", () => {
  it("turns a Hebrew query into dash-separated words", () => {
    expect(slugFromQuery("אוזניות לריצה עמידות למים")).toBe("אוזניות-לריצה-עמידות-למים");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugFromQuery("  אוזניות לריצה,  עמידות למים!! ")).toBe("אוזניות-לריצה-עמידות-למים");
    expect(slugFromQuery("מחזיק (טלפון) / לרכב...")).toBe("מחזיק-טלפון-לרכב");
    expect(slugFromQuery("---שלום---עולם---")).toBe("שלום-עולם");
  });

  it("drops quotes inside words and spells the shekel sign", () => {
    expect(slugFromQuery("אוזניות לריצה, עמידות למים, עד 100 ש״ח")).toBe(
      "אוזניות-לריצה-עמידות-למים-עד-100-שח",
    );
    expect(slugFromQuery('עד 50 ש"ח')).toBe("עד-50-שח");
    expect(slugFromQuery("עד 100₪")).toBe("עד-100-שח");
    expect(slugFromQuery("צ׳יפס")).toBe("ציפס");
  });

  it("removes niqqud and treats the maqaf as a separator", () => {
    expect(slugFromQuery("שָׁלוֹם")).toBe("שלום");
    expect(slugFromQuery("בית־ספר")).toBe("בית-ספר");
  });

  it("lowercases Latin letters and keeps digits", () => {
    expect(slugFromQuery("מטען USB-C 65W")).toBe("מטען-usb-c-65w");
  });

  it("drops characters outside Hebrew, Latin and digits", () => {
    expect(slugFromQuery("מנורה 🌙 לילה")).toBe("מנורה-לילה");
    expect(slugFromQuery("🌙✨")).toBe("");
    expect(slugFromQuery("")).toBe("");
  });

  it("keeps final letters", () => {
    expect(slugFromQuery("כלים לגן ילדים")).toBe("כלים-לגן-ילדים");
  });

  it("cuts at a word boundary to at most 60 characters", () => {
    const query = "מארגן מגירות למטבח עם חלוקה מתכווננת עמיד למים ומתאים לכל סוגי המגירות בבית";
    const slug = slugFromQuery(query);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(isValidSlug(slug)).toBe(true);
    // Whole words only: the slug is a prefix of the full slug, ending before a dash.
    const full = query.split(" ").join("-");
    expect(full.startsWith(`${slug}-`)).toBe(true);
  });

  it("cuts a single overlong word", () => {
    const slug = slugFromQuery("א".repeat(80));
    expect(slug).toBe("א".repeat(SLUG_MAX_LENGTH));
  });

  it("always returns a valid slug or an empty string", () => {
    for (const q of ["מתנה לילדה בת 8 עד 150 ש״ח", "a.b.c", "!!!", "  -  ", "x".repeat(100)]) {
      const slug = slugFromQuery(q);
      expect(slug === "" || isValidSlug(slug)).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  it("accepts Hebrew, lowercase Latin, digits and single inner dashes", () => {
    expect(isValidSlug("אוזניות-לריצה")).toBe(true);
    expect(isValidSlug("usb-c-65w")).toBe(true);
    expect(isValidSlug("100")).toBe(true);
  });

  it("rejects everything else", () => {
    for (const bad of [
      "",
      "-אוזניות",
      "אוזניות-",
      "אוזניות--לריצה",
      "אוזניות לריצה",
      "USB",
      "שָׁלוֹם",
      "a/b",
      "a_b",
      "../x",
      "%D7%90",
      "א".repeat(SLUG_MAX_LENGTH + 1),
    ]) {
      expect(isValidSlug(bad), bad).toBe(false);
    }
    expect(isValidSlug(undefined)).toBe(false);
    expect(isValidSlug(42)).toBe(false);
  });

  it("accepts exactly the maximum length", () => {
    expect(isValidSlug("א".repeat(SLUG_MAX_LENGTH))).toBe(true);
  });
});

describe("normalizeSlugInput", () => {
  it("trims, lowercases and turns spaces and maqaf into single dashes", () => {
    expect(normalizeSlugInput("  אוזניות  לריצה ")).toBe("אוזניות-לריצה");
    expect(normalizeSlugInput("USB-C--Cable")).toBe("usb-c-cable");
    expect(normalizeSlugInput("-בית־ספר-")).toBe("בית-ספר");
  });

  it("leaves other characters for validation to report", () => {
    expect(isValidSlug(normalizeSlugInput("אוזניות/לריצה"))).toBe(false);
  });
});

describe("parseSlugParam", () => {
  it("accepts a decoded or percent-encoded slug", () => {
    expect(parseSlugParam("אוזניות-לריצה")).toBe("אוזניות-לריצה");
    expect(parseSlugParam(encodeURIComponent("אוזניות-לריצה"))).toBe("אוזניות-לריצה");
  });

  it("returns null for anything that cannot be a slug", () => {
    expect(parseSlugParam("%E0%A4%A")).toBe(null); // malformed escape
    expect(parseSlugParam("a b")).toBe(null);
    expect(parseSlugParam("")).toBe(null);
    expect(parseSlugParam("%2e%2e%2fadmin")).toBe(null);
  });
});

describe("seoPath", () => {
  it("percent-encodes the slug and round-trips", () => {
    const path = seoPath("אוזניות-לריצה");
    expect(path).toMatch(/^\/s\/[A-Za-z0-9%-]+$/);
    expect(decodeURIComponent(path)).toBe("/s/אוזניות-לריצה");
    expect(seoPath("usb-c")).toBe("/s/usb-c");
  });
});
