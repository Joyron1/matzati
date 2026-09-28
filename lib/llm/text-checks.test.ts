import { describe, expect, it } from "vitest";
import {
  comparisonSizes,
  fixSpelling,
  hasForeignScript,
  hasForeignWord,
  hasGarbledWord,
  hasMixedScript,
  isTruncated,
  mentionsBudget,
  superlativeClaims,
  tidyHebrew,
  usesSingularAddress,
  withoutForeignWords,
  writesPrice,
} from "./text-checks";

describe("fixSpelling", () => {
  it("fixes the shopper's typo that reached every line (typo-earbuds, eval round 3)", () => {
    expect(fixSpelling("אוזניות ספורט עמידות למיים")).toBe("אוזניות ספורט עמידות למים");
    expect(fixSpelling("עמידות במיים ומיים")).toBe("עמידות במים ומים");
  });
  it("fixes the model's misspellings", () => {
    expect(fixSpelling("אטום לדיסות")).toBe("אטום לדליפות");
    expect(fixSpelling("צעצוע למידת צבעים ותפתוח חושי")).toBe("צעצוע למידת צבעים ופיתוח חושי");
    expect(fixSpelling("משחזת נייידה")).toBe("משחזת ניידה");
    expect(fixSpelling("אוזניות הולכה עצם")).toBe("אוזניות הולכת עצם");
  });
  it("writes Bluetooth the usual way, and keeps the spelling with a geresh", () => {
    expect(fixSpelling("אוזניות בלוטות לריצה")).toBe("אוזניות בלוטוס לריצה");
    expect(fixSpelling("רמקול בלוטות׳ עמיד למים")).toBe("רמקול בלוטות׳ עמיד למים");
  });
  it("leaves real words that contain the letters alone", () => {
    for (const text of ["כחול שמיים", "בשמיים", "פרדיסות", "מים", "דליפות"]) {
      expect(fixSpelling(text)).toBe(text);
    }
  });
});

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
  it("fixes the known misspellings too", () => {
    expect(tidyHebrew("אוזניות עמידות למיים עם Bluetooth")).toBe(
      "אוזניות עמידות למים עם Bluetooth",
    );
  });
});

describe("hasGarbledWord", () => {
  it("flags the garbled words the model wrote (eval round 3, the live site)", () => {
    expect(hasGarbledWord("אוזניות Lenovo Bluetooth 5.4 עצם הסיסמום IPX8")).toBe(true);
    expect(hasGarbledWord("נעלי בית חמות סופטניות עם סוליה שטוחה")).toBe(true);
    expect(hasGarbledWord("מארגן לצנצנות תבלינים וזקנין.")).toBe(true);
    expect(hasGarbledWord("סל קולפסיבילי לכביסה")).toBe(true);
  });
  it("passes plain Hebrew", () => {
    expect(hasGarbledWord("אוזניות הולכת עצם עמידות למים")).toBe(false);
  });
});

describe("mentionsBudget", () => {
  it("finds the budget word in any prefix form", () => {
    expect(mentionsBudget("בקבוק אטום לדליפות ומתחת לתקציב שלכם.")).toBe(true);
    expect(mentionsBudget("בתוך התקציב שלכם.")).toBe(true);
  });
  it("finds nothing in a line without it", () => {
    expect(mentionsBudget("98% משוב חיובי ו־304 נמכרו ב־30 הימים האחרונים.")).toBe(false);
  });
});

describe("Latin words in Hebrew copy", () => {
  // Recorded round-3 titles (fixtures/llm/eval-v3-2026-09-27.json).
  const drawer =
    "Expandable Kitchen Cabinet Drawer Organizer Rack, Multi‑Purpose Storage Shelf for Pots, Pans, Pot Lids, Cutting Boards Cookware";
  const spice =
    "4 Layers Kitchen Spice Drawer Organizer Adjustable Spice Rack for Spice Jars Seasoning Bottles Cabinet Pantry Kitchen Organizer";
  const oppo =
    "New For OPPO Ultra Thin Smart Watch Men AMOLED HD Screen Always Show Time Heart Rate Bluetooth Call Sports Waterproof Smartwatch";
  const ht30 =
    "2026 New Smart Watch Bluetooth Call Fitness Tracker Heart Rate Sleep Record Outdoor Sport Watch for Android/IOS Men Women HT30";
  const mount =
    "Magnetic Car Wireless Charger Stand Magnet Car Mount Fast Charging Station Phone Holder Bracket For Macsfae iPhone 15 14 13 12";
  const ktm =
    "Ready to Race Logo Waterproof Motorcycle Backpack Hiking Lightweight Trekking Fishing Duffel Bag For KTM Ready to Race Adv Duke";
  const mouse =
    "Bluetooth-compatible Mouse Wireless Mouse Silent Computer Mice Portable Working Gaming Mouse for Laptop iPad Air Pro Tablet PC";

  it("drops a plain English word, which is not a brand, model or spec", () => {
    expect(withoutForeignWords("מארגן מגירות מטבח Expandable למחבתות", drawer)).toBe(
      "מארגן מגירות מטבח למחבתות",
    );
    // The number after it belongs to the Hebrew: "4 שכבות" stays.
    expect(withoutForeignWords("מארגן תבלינים Adjustable 4 שכבות", spice)).toBe(
      "מארגן תבלינים 4 שכבות",
    );
    expect(withoutForeignWords("תיק גב Ready to Race עמיד למים לטיולים", ktm)).toBe(
      "תיק גב עמיד למים לטיולים",
    );
  });

  it("drops the words that belong to the dropped name", () => {
    expect(withoutForeignWords("מעמד לטעינה אלחוטית מגנטי לאוטו Fast Charging", mount)).toBe(
      "מעמד לטעינה אלחוטית מגנטי לאוטו",
    );
    expect(withoutForeignWords("מעמד מגנטי לרכב עם Fast Charging", mount)).toBe("מעמד מגנטי לרכב");
    // "2.4G" is not in the title: the model made it up, so it goes with its "ו־".
    expect(withoutForeignWords("עכבר אלחוטי שקט Bluetooth ו־2.4G", mouse)).toBe("עכבר אלחוטי שקט");
  });

  it("never names the brand of the device a product fits as its own brand", () => {
    expect(withoutForeignWords("שעון חכם OPPO עם מד דופק", oppo)).toBe("שעון חכם עם מד דופק");
    expect(hasForeignWord("מחזיק מגנטי לרכב iPhone 15", mount)).toBe(true);
    // Said as "for", it is true.
    expect(hasForeignWord("מחזיק מגנטי לרכב ל־iPhone 15", mount)).toBe(false);
    expect(hasForeignWord("מחזיק מגנטי לרכב תואם iPhone 15", mount)).toBe(false);
    const cable =
      "100W C to C USB C to USB C PD Cable for iPhone 15 Pro Max iPad 10 MacBook Huawei Xiaomi";
    expect(hasForeignWord("כבל USB-C לאייפון 15 Pro Max", cable)).toBe(false);
    // A model name far after "for" is the product's own: "... for Android/IOS Men Women HT30".
    expect(hasForeignWord("שעון חכם HT30 עם מד דופק", ht30)).toBe(false);
  });

  it("keeps brands, models and specs the title states", () => {
    const keep: [string, string][] = [
      [
        "שעון חכם LAXASFIT עם מד דופק",
        "LAXASFIT Smartwatch Bluetooth Talk Smartwatch Message Alert Heart Rate Monitor Sports Watch",
      ],
      [
        "אוזניות Lenovo S102 הולכת עצם Bluetooth V6.0",
        "Lenovo S102 Bone Conduction Bluetooth V6.0 Earphones Wireless Sports Headphones Waterproof",
      ],
      [
        "אוזניות GDLYL HD65 TWS Bluetooth V5.4 עמידות למים",
        "Original GDLYL HD65 TWS Bluetooth V5.4 Headphones Wireless LED Digital Display Earphones",
      ],
      [
        "רמקול Zealot-S32 אלחוטי עמיד למים IPX 6",
        "Zealot-S32 Wireless Speaker Outdoor Portable Subwoofer Speaker, Waterproof IPX 6, Dual Pairing",
      ],
      [
        "סוללת גיבוי Baseus 10000mAh 22.5W עם כבל USB-C משולב",
        "Baseus 10000mAh Power Bank 22.5W Built-In Dual USB-C Cable Thinner Fast Charging",
      ],
      [
        "כבל USB-C ל־USB-C 60W עם PD לאייפון 15",
        "PD 60W USB C to USB Type C Cable Fast Charge Data Cable For Iphone 15 15Pro Huawei",
      ],
      [
        "בקבוק מים לילדים 650ml ללא BPA עם קשית",
        "650ml Cute Kids Water Bottle With Straw Free BPA Leakproof Outdoor Portable Children's Cups",
      ],
      [
        "תיק גב טקטי 38L עמיד למים עם מערכת MOLLE",
        "38L Tactical Backpack Style, Large Capacity Waterproof Outdoor Rucksack with MOLLE System",
      ],
      [
        "כרית צוואר U מתנפחת עם משאבה",
        "U Shaped Inflatable Travel Pillow Push Pump Portable Air Neck Support Cushion For Flight",
      ],
      [
        "רמקול Tribit PocketGo עמיד למים",
        "Tribit PocketGo Portable Bluetooth Speaker IP68 Waterproof BT6.0 Built-in Mic TWS",
      ],
      [
        "משטח סיליקון לטסלה 3/Y",
        "Car Wireless Charging Pad For New Tesla Model 3/Y 2024 2023 2022 Center Console Charger Mat",
      ],
    ];
    for (const [text, title] of keep) {
      expect([text, hasForeignWord(text, title)]).toEqual([text, false]);
      expect(withoutForeignWords(text, title)).toBe(text);
    }
  });

  it("does not take capitals for a brand in a title written in capitals", () => {
    const shouting = "EXPANDABLE KITCHEN DRAWER ORGANIZER ADJUSTABLE CUTLERY TRAY";
    expect(hasForeignWord("מארגן מגירות EXPANDABLE", shouting)).toBe(true);
  });

  it("ignores numbers and plain Hebrew", () => {
    expect(hasForeignWord("98% משוב חיובי ו־3,156 נמכרו ב־30 הימים האחרונים.", mount)).toBe(false);
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

  it("reads the scopes of a page of five: four and five", () => {
    expect(comparisonSizes("והזול מבין החמישה.")).toEqual([5]);
    expect(comparisonSizes("הנמכר ביותר מבין חמשת המוצרים.")).toEqual([5]);
    expect(comparisonSizes("והזול מבין הארבעה.")).toEqual([4]);
    expect(comparisonSizes("המשוב הגבוה ביותר מבין ארבעת המוצרים.")).toEqual([4]);
    // A word that only starts like a number is not a scope.
    expect(comparisonSizes("מבין החמישיות.")).toEqual([]);
  });

  it("keeps a claim with its five scope, so nothing is left unverifiable", () => {
    expect(superlativeClaims("100% משוב חיובי והזול מבין החמישה.")).toEqual(["cheapest"]);
    expect(superlativeClaims("המשתלם מבין החמישה.")).toEqual(["unverifiable"]);
  });
});
