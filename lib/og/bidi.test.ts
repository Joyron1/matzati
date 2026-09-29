import { describe, expect, it } from "vitest";
import { clip, isRtlText, ogWords } from "./bidi";

describe("ogWords", () => {
  it("reverses each Hebrew word and keeps the reading order of the words", () => {
    expect(ogWords("אוזניות לריצה")).toEqual(["תוינזוא", "הצירל"]);
  });

  it("keeps numbers and English as they are, a run of them as one unit", () => {
    expect(ogWords("עד 100 ש״ח")).toEqual(["דע", "100", "ח״ש"]);
    expect(ogWords("כבל ל־iPhone 15 Pro מהיר")).toEqual(["לבכ", "iPhone 15 Pro־ל", "ריהמ"]);
    expect(ogWords("מטען iPhone 15 Pro, מהיר")).toEqual(["ןעטמ", ",iPhone 15 Pro", "ריהמ"]);
  });

  it("puts a number inside a Hebrew word on the correct side", () => {
    expect(ogWords("ב־30 הימים")).toEqual(["30־ב", "םימיה"]);
    expect(ogWords("95% משוב")).toEqual(["95%", "בושמ"]);
  });

  it("mirrors brackets and moves punctuation to the visual end", () => {
    expect(ogWords("(מארז)")).toEqual(["(זראמ)"]);
    expect(ogWords("מתנה, לילד.")).toEqual([",הנתמ", ".דליל"]);
    expect(ogWords("חיבור (USB-C)")).toEqual(["רוביח", "(USB-C)"]);
  });

  it("keeps niqqud on its letter", () => {
    // Graphemes reversed, never code points: שָׁ keeps both its marks.
    expect(ogWords("שָׁלוֹם")).toEqual(["ם" + "וֹ" + "ל" + "שָׁ"]);
  });

  it("leaves text without Hebrew word by word", () => {
    expect(ogWords("Wireless  Earbuds 5.3")).toEqual(["Wireless", "Earbuds", "5.3"]);
    expect(isRtlText("Wireless Earbuds")).toBe(false);
    expect(isRtlText("אוזניות")).toBe(true);
  });
});

describe("clip", () => {
  it("keeps short text and cuts long text at a word", () => {
    expect(clip("  אוזניות   לריצה ", 40)).toBe("אוזניות לריצה");
    expect(clip("אוזניות אלחוטיות לריצה עמידות למים", 20)).toBe("אוזניות אלחוטיות…");
    expect(clip("אחת, שתיים שלוש", 12)).toBe("אחת, שתיים…");
  });
});
