import { describe, expect, it } from "vitest";
import { fixTransliterations, TRANSLITERATIONS } from "./transliterations";

const PLUSH_BED =
  "40-90cm 6 Sizes Round Pet Bed for Large Dog Bed Super Soft Cat Bed Plush Dog House for Medium Dog House Winter Warm Sleeping";

describe("fixTransliterations", () => {
  it("fixes the titles seen on the live site", () => {
    expect(fixTransliterations("מיטת כלב עגולה פלוש חמה לחורף", PLUSH_BED)).toBe(
      "מיטת כלב עגולה מפרווה רכה חמה לחורף",
    );
    expect(fixTransliterations("בובת Sonic פלוש 30 ס״מ")).toBe("בובת Sonic מפרווה רכה 30 ס״מ");
    expect(
      fixTransliterations(
        "מיטת כלב פלאפי עם בסיס נגד החלקה",
        "Extra Soft Pink Fluffy Dog Plush Pillow Bed Sofa Cushion with Non-Slip Base",
      ),
    ).toBe("מיטת כלב מפרווה רכה עם בסיס נגד החלקה");
    expect(fixTransliterations("2 בסיסים אוניברסליים לסאונד בר וספיקרים")).toBe(
      "2 בסיסים אוניברסליים לסאונד בר ורמקולים",
    );
    expect(fixTransliterations("מארגן ביגוד קולפסיבילי 1/2/3 חלקים")).toBe(
      "מארגן ביגוד בעיצוב מתקפל 1/2/3 חלקים",
    );
    expect(fixTransliterations("אוזניות ספורט K58 Bluetooth נקבנד עם מיקרופון")).toBe(
      "אוזניות ספורט K58 Bluetooth עם רצועת צוואר עם מיקרופון",
    );
  });

  it("replaces a spelling that also means something else only when the English title says so", () => {
    // "פלאש" is also a camera flash or a flash drive.
    expect(fixTransliterations("פלאש למצלמה", "Camera Flash Speedlite")).toBe("פלאש למצלמה");
    expect(fixTransliterations("בובת פלאש", undefined)).toBe("בובת פלאש");
    expect(fixTransliterations("בובת פלאש", "Anime Plush Doll")).toBe("בובת מפרווה רכה");
    // Fluffy eyelashes are not fur.
    expect(fixTransliterations("ריסים פלאפיים", "Thick and Fluffy False Eyelashes")).toBe(
      "ריסים פלאפיים",
    );
  });

  it("keeps a prefix only where the phrase still reads right", () => {
    expect(fixTransliterations("בובה רכה ופלוש")).toBe("בובה רכה ומפרווה רכה");
    // "במפרווה רכה" would be wrong: left alone.
    expect(fixTransliterations("מצופה בפלוש")).toBe("מצופה בפלוש");
    // A noun takes any prefix.
    expect(fixTransliterations("מעמד לספיקר")).toBe("מעמד לרמקול");
  });

  it("matches whole words only", () => {
    for (const text of ["פלושים", "ספיקרון", "הפלוש׳", "פלאפון"]) {
      expect(fixTransliterations(text, PLUSH_BED)).toBe(text);
    }
  });

  it("leaves correct Hebrew, Latin names and empty text alone", () => {
    for (const text of ["מיטת כלב פלנל חורפית מרופדת", "רמקול Edifier MP85 Bluetooth", ""]) {
      expect(fixTransliterations(text, PLUSH_BED)).toBe(text);
    }
  });

  it("is idempotent: no replacement holds a word of the table", () => {
    for (const t of TRANSLITERATIONS) {
      for (const w of t.words) {
        const english = `${t.en.source.replace(/[^a-z ]/gi, "")} product`;
        const once = fixTransliterations(`מוצר ${w} חדש`, english);
        expect(once).not.toContain(w);
        expect(fixTransliterations(once, english)).toBe(once);
      }
    }
  });
});
