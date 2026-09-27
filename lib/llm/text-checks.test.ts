import { describe, expect, it } from "vitest";
import {
  comparisonSizes,
  hasForeignScript,
  hasMixedScript,
  isTruncated,
  superlativeClaims,
  tidyHebrew,
  usesSingularAddress,
  writesPrice,
} from "./text-checks";

describe("hasForeignScript", () => {
  it("flags Arabic letters mixed into Hebrew (seen in a real Haiku output)", () => {
    expect(hasForeignScript("אוזניות ספורט אלחוטיות עם חיבור לרقبה")).toBe(true);
  });
  it("allows Hebrew with Latin model names, numbers and symbols", () => {
    expect(hasForeignScript("אוזניות עצם B8 Bluetooth 5.3 IPX5, ₪34.51, 52%")).toBe(false);
  });
});

describe("usesSingularAddress", () => {
  it("flags singular second person", () => {
    expect(usesSingularAddress("במחיר שמתאים לתקציב שלך.")).toBe(true);
    expect(usesSingularAddress("זה בדיוק מה שאתה צריך")).toBe(true);
    expect(usesSingularAddress("אם אתה רץ בגשם")).toBe(true);
  });
  it("accepts plural address and unrelated words containing the letters", () => {
    expect(usesSingularAddress("במחיר שמתאים לתקציב שלכם.")).toBe(false);
    expect(usesSingularAddress("מתאים למי שהולך הרבה")).toBe(false);
  });
});

describe("tidyHebrew", () => {
  it("puts a maqaf between a one-letter prefix and Latin or digits", () => {
    // Real Haiku output: "בעל PD 65W וQC3.0".
    expect(tidyHebrew("בעל PD 65W וQC3.0 לטלפון")).toBe("בעל PD 65W ו־QC3.0 לטלפון");
    expect(tidyHebrew("תמיכה ב-PD ו-USB")).toBe("תמיכה ב־PD ו־USB");
    expect(tidyHebrew("(בLED)")).toBe("(ב־LED)");
  });
  it("uses the Hebrew marks in abbreviations", () => {
    expect(tidyHebrew("אורך 20 ס\"מ ומסך 2 אינץ'")).toBe("אורך 20 ס״מ ומסך 2 אינץ׳");
  });
  it("leaves words, ranges and quoted phrases alone", () => {
    const text = 'מזרן "נגד החלקה" בעובי 3-5 מ״מ, Model X';
    expect(tidyHebrew(text)).toBe(text);
    expect(tidyHebrew("מזרן 'נגד החלקה' עבה")).toBe("מזרן 'נגד החלקה' עבה");
  });
});

describe("hasMixedScript", () => {
  it("flags Latin letters inside a Hebrew word (seen in a real Haiku output)", () => {
    expect(hasMixedScript("עם רשult לא החלקה")).toBe(true);
    expect(hasMixedScript("מטעןUSB")).toBe(true);
    expect(hasMixedScript("ובPD")).toBe(true);
  });
  it("allows Latin words next to Hebrew and a prefix with a maqaf", () => {
    expect(hasMixedScript("אוזניות GDLYL HD65 עם Bluetooth V5.4")).toBe(false);
    expect(hasMixedScript("תמיכה ב־PD ו־QC3.0")).toBe(false);
  });
});

describe("isTruncated", () => {
  it("flags a line cut at an ASCII quote (seen in a real Haiku output)", () => {
    expect(isTruncated("מארגן פלסטיק לסכו", 25)).toBe(true);
  });
  it("flags a long line without final punctuation", () => {
    expect(isTruncated("מזרן יוגה דו־שכבתי נגד החלקה עם רצועת נשיאה", 25)).toBe(true);
  });
  it("accepts a complete sentence", () => {
    expect(isTruncated("מזרן יוגה דו־שכבתי נגד החלקה עם רצועת נשיאה.", 25)).toBe(false);
  });
});

describe("writesPrice", () => {
  it("flags prices in any format the model used", () => {
    expect(writesPrice("שעון חכם במחיר ₪14.48.")).toBe(true);
    expect(writesPrice("במחיר הנמוך ביותר של 27.31₪.")).toBe(true);
    expect(writesPrice("במחיר 94.31 ש״ח.")).toBe(true);
    expect(writesPrice("במחיר 2.4 שקלים.")).toBe(true);
    expect(writesPrice("במחיר 80.1, עם הנחה.")).toBe(true);
  });
  it("allows budget wording without a number, and words that contain שקל", () => {
    expect(writesPrice("מתחת לתקציב שלכם, עם הנחה של 52%.")).toBe(false);
    expect(writesPrice("משקל נמוך ומחיר נוח.")).toBe(false);
  });
});

describe("superlativeClaims", () => {
  it("finds verifiable comparisons in the forms Haiku used", () => {
    expect(superlativeClaims("הכבל הזול ביותר ברשימה.")).toEqual(["cheapest"]);
    expect(superlativeClaims("מחיר הכי נמוך בקבוצה.")).toEqual(["cheapest"]);
    expect(superlativeClaims("100% משוב חיובי והזול מבין השלושה.")).toEqual(["cheapest"]);
    expect(superlativeClaims("עם המכירות הגבוהות ביותר.")).toEqual(["most_sold"]);
    expect(superlativeClaims("הנמכר ביותר מבין השלושה.")).toEqual(["most_sold"]);
    expect(superlativeClaims("המשוב החיובי הגבוה ביותר מבין השלושה.")).toEqual(["top_feedback"]);
    expect(superlativeClaims("ההנחה הגדולה ביותר מבין השלושה.")).toEqual(["top_discount"]);
    expect(superlativeClaims("הזול והנמכר ביותר מבין השניים.")).toEqual(["cheapest", "most_sold"]);
  });
  it("marks any other superlative as unverifiable", () => {
    expect(superlativeClaims("האוזניות הכי טובות לריצה.")).toEqual(["unverifiable"]);
    expect(superlativeClaims("מתאים בצמוד ביותר לדרישתכם.")).toEqual(["unverifiable"]);
    expect(superlativeClaims("הרעש הכי נמוך.")).toEqual(["unverifiable"]);
    expect(superlativeClaims("המשתלם מבין השלושה.")).toEqual(["unverifiable"]);
    expect(superlativeClaims("זול יותר משני האחרים.")).toEqual(["unverifiable"]);
  });
  it("finds nothing in plain lines", () => {
    expect(superlativeClaims("98% משוב חיובי ו־405 נמכרו ב־30 הימים האחרונים.")).toEqual([]);
    expect(superlativeClaims("מחיר נמוך יותר מהתקציב שלכם.")).toEqual([]);
  });
});

describe("comparisonSizes", () => {
  it("reads how many products a comparison covers", () => {
    expect(comparisonSizes("100% משוב חיובי והזול מבין השלושה.")).toEqual([3]);
    expect(comparisonSizes("הנמכר ביותר מבין שני המוצרים.")).toEqual([2]);
    expect(comparisonSizes("98% משוב חיובי.")).toEqual([]);
  });
});
