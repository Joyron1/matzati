import { describe, expect, it } from "vitest";
import type { Requirement } from "@/lib/search/filters";
import {
  normalizePhrase,
  parseSpec,
  phraseMatches,
  requirementMatches,
  requirementPhrases,
  stem,
  tokenize,
  titleMeetsSpec,
} from "./match";

const req = (en: string, alt: string[] = []): Requirement => ({ en, alt, he: "דרישה" });

describe("tokenize", () => {
  it("unifies every USB-C spelling", () => {
    expect(tokenize("USB-C to Type-C")).toEqual(["usbc", "to", "usbc"]);
    expect(tokenize("USB Type C Cable")).toEqual(["usb", "usbc", "cable"]);
    expect(tokenize("TypeC usb c")).toEqual(["usbc", "usbc"]);
    expect(tokenize("USB Charger")).toEqual(["usb", "charger"]);
  });

  it("drops plurals without breaking words that end in s", () => {
    expect(tokenize("Watches Boxes Batteries Earphones Ties Cables")).toEqual([
      "watch",
      "box",
      "battery",
      "earphone",
      "tie",
      "cable",
    ]);
    expect(tokenize("Wireless Glass Plus GPS 3pcs")).toEqual([
      "wireless",
      "glass",
      "plus",
      "gps",
      "3pcs",
    ]);
  });

  it("gives -ie nouns and irregular plurals one singular form", () => {
    expect(tokenize("Hoodies Hoodie Beanies")).toEqual(["hoody", "hoody", "beany"]);
    expect(tokenize("Knives Knife Shelves Lenses Lens")).toEqual([
      "knife",
      "knife",
      "shelf",
      "lens",
      "lens",
    ]);
    expect(tokenize("Tie Ties Pies")).toEqual(["tie", "tie", "pie"]);
    expect(tokenize("Magnetic Constructor")).toEqual(["magnetic", "constructor"]);
  });
});

describe("stem", () => {
  it("maps charging, charger and chargers to one stem", () => {
    expect(stem("charging")).toBe("charg");
    expect(stem("charger")).toBe("charg");
    expect(tokenize("Chargers").map(stem)).toEqual(["charg"]);
    expect(stem("organizer")).toBe("organiz");
  });

  it("leaves short words alone", () => {
    for (const w of ["holder", "drawer", "folding", "water", "power", "ring", "65w"]) {
      expect(stem(w)).toBe(w);
    }
  });
});

describe("phraseMatches", () => {
  it("matches a phrase across charger/charging and small gaps", () => {
    // The squash-and-substring matcher missed this real car-holder title.
    const title = "Magnetic Car Wireless Charger Mount 15W Fast Charging For iPhone 12";
    expect(phraseMatches(title, "wireless charging")).toBe(true);
    expect(phraseMatches("Wireless Car Charger Holder", "wireless charging")).toBe(true);
  });

  it("needs the words in order and at most 2 tokens apart", () => {
    expect(phraseMatches("Wireless Mouse Keyboard Combo Charging Dock", "wireless charging")).toBe(
      false,
    );
    expect(phraseMatches("Fast Charging Wireless Mouse", "wireless charging")).toBe(false);
  });

  it("treats USB-C spellings as one word", () => {
    expect(phraseMatches("USB Type C Cable 2.4A Fast Charging", "usb-c cable")).toBe(true);
    expect(phraseMatches("Type-C to Type-C Cable", "usb c cable")).toBe(true);
  });

  it("counts USB-C as USB, but not plain USB as USB-C", () => {
    expect(phraseMatches("PD 60W USB-C to USB-C Cable", "usb cable")).toBe(true);
    expect(phraseMatches("LED Desk Lamp Type-C Charging Foldable", "usb charging")).toBe(true);
    expect(phraseMatches("USB 2.0 Cable 1M", "usb-c cable")).toBe(false);
  });

  it("lets letter-only terms match a trailing number", () => {
    expect(phraseMatches("Sports Earbuds IPX7 Bluetooth", "ipx")).toBe(true);
    expect(phraseMatches("Car Charger QC3.0 Dual Port", "qc")).toBe(true);
    expect(phraseMatches("Sports Earbuds Ipxtra Bluetooth", "ipx")).toBe(false);
  });

  it("never matches weak words on their own", () => {
    expect(phraseMatches("Non-slip Bath Mat", "non")).toBe(false);
    expect(phraseMatches("Kids Cup With Straw", "with")).toBe(false);
    expect(phraseMatches("Kids Cup", "")).toBe(false);
    expect(phraseMatches("Non-Spill Sippy Cup for Toddlers", "non spill")).toBe(true);
    expect(phraseMatches("Non-toxic Silicone Kids Cup Spill Tray", "non spill")).toBe(false);
  });

  it("reads numeric specs as a minimum", () => {
    expect(phraseMatches("Essager 67W GaN USB Type C Charger For Laptop 45W 25W", "65w")).toBe(
      true,
    );
    expect(phraseMatches("20W PD Fast Charger", "65w")).toBe(false);
  });
});

describe("parseSpec and titleMeetsSpec", () => {
  it("parses number-unit phrases only", () => {
    expect(parseSpec("65W")).toEqual({ value: 65, unit: "w" });
    expect(parseSpec("10000 mah")).toEqual({ value: 10000, unit: "mah" });
    expect(parseSpec("2.5 inch")).toEqual({ value: 2.5, unit: "inch" });
    expect(parseSpec("27-inch")).toEqual({ value: 27, unit: "inch" });
    expect(parseSpec("65 watts")).toEqual({ value: 65, unit: "w" });
    expect(parseSpec("144hz")).toEqual({ value: 144, unit: "hz" });
    expect(parseSpec("heart rate")).toBeNull();
    expect(parseSpec("usb3")).toBeNull();
  });

  it("finds units glued to other text and ignores longer units", () => {
    const w60 = { value: 60, unit: "w" } as const;
    expect(titleMeetsSpec("0.28M Short USB Type C Cable PD60W Fast Charging", w60)).toBe(true);
    expect(
      titleMeetsSpec("0.28M Short USB Type C Cable PD60W Fast Charging", { ...w60, value: 65 }),
    ).toBe(false);
    expect(titleMeetsSpec("USB4.0 40Gbps Cable", { value: 40, unit: "gb" })).toBe(false);
    expect(titleMeetsSpec("2 Way Splitter", { value: 1, unit: "w" })).toBe(false);
  });

  it("compares capacity, storage and size", () => {
    expect(titleMeetsSpec("Power Bank 20000mAh PD", { value: 10000, unit: "mah" })).toBe(true);
    expect(titleMeetsSpec("Mini Power Bank 5000mAh", { value: 10000, unit: "mah" })).toBe(false);
    expect(titleMeetsSpec("Power Bank 10,000 mAh", { value: 10000, unit: "mah" })).toBe(true);
    expect(titleMeetsSpec("Portable SSD 1TB", { value: 2, unit: "tb" })).toBe(false);
    expect(titleMeetsSpec("Monitor 27 Inches IPS", { value: 24, unit: "inch" })).toBe(true);
  });

  it("compares storage across GB and TB", () => {
    expect(titleMeetsSpec("Portable SSD 1TB USB 3.2", { value: 512, unit: "gb" })).toBe(true);
    expect(titleMeetsSpec("Portable SSD 1TB", { value: 2, unit: "tb" })).toBe(false);
    expect(titleMeetsSpec("Hard Drive 2000GB", { value: 2, unit: "tb" })).toBe(true);
  });

  it("reads hyphenated units, watts and refresh rates", () => {
    expect(titleMeetsSpec("Monitor 27-Inch IPS", { value: 24, unit: "inch" })).toBe(true);
    expect(titleMeetsSpec("GaN Charger 100 Watt", { value: 65, unit: "w" })).toBe(true);
    expect(titleMeetsSpec("Gaming Monitor 165Hz 1ms", { value: 144, unit: "hz" })).toBe(true);
    expect(titleMeetsSpec("Office Monitor 75Hz", { value: 144, unit: "hz" })).toBe(false);
    expect(titleMeetsSpec("Wireless Mouse 2.4GHz", { value: 2, unit: "hz" })).toBe(false);
  });
});

describe("requirementMatches", () => {
  it("passes the three recorded chargers for 65W and fails smaller ones", () => {
    const r = req("65w");
    for (const title of [
      "Essager 67W GaN USB Type C Charger For Laptop 45W 25W PD QC 3.0 Fast Charge For Macbook",
      "100W GaN PD Type C Charger USB QC 3.0 For Laptop Ipad PPS Fast Charge EU UK",
      "Real 85W GaN Type C Charger USB QC3.0 For Laptop Ipad PPS PD 65W Fast Charge",
    ]) {
      expect(requirementMatches(title, r)).toBe(true);
    }
    expect(requirementMatches("33W GaN Fast Charger USB C PD", r)).toBe(false);
  });

  it("rejects recorded watches whose titles never mention heart rate", () => {
    const r = req("heart rate", ["heart rate monitor"]);
    expect(
      requirementMatches(
        "LAXASFIT Smartwatch Bluetooth Talk Smartwatch Message Alert Heart Rate Monitor Sports Watch",
        r,
      ),
    ).toBe(true);
    expect(
      requirementMatches(
        "LAXASFIT 2025 New Smart Watch for Men Women Gift Full Touch Screen Sports Fitness Watch Bluetooth Call Digital Smartwatch",
        r,
      ),
    ).toBe(false);
    expect(
      requirementMatches(
        "2026 Smart Watch Android IOS Phone 2.01Inch Color Screen Bluetooth Answer Call Fitness Watches Tracker Smartwatch Women Men Ht22",
        r,
      ),
    ).toBe(false);
  });

  it("rejects recorded earbuds that never claim to be waterproof", () => {
    const r = req("waterproof");
    expect(
      requirementMatches(
        "Original SP16 Sports Wireless Earphones over Ear Buds with Earhooks True Wireless Running In-Ear Headphones",
        r,
      ),
    ).toBe(false);
    expect(
      requirementMatches(
        "POLVCDG X9 Bone Conduction Earphones 32G IPX8 Open Design for Swimming Running",
        r,
      ),
    ).toBe(true);
  });

  it("accepts the requirement's own alternatives", () => {
    expect(requirementMatches("Kids Bottle No Drip Straw", req("leak proof", ["no drip"]))).toBe(
      true,
    );
  });

  it("fails a requirement that has nothing checkable", () => {
    expect(requirementMatches("Non-slip Kids Bottle", req("non", ["anti"]))).toBe(false);
  });

  it.each([
    ["waterproof", "Bone Conduction Headphones IPX8 Swimming"],
    ["waterproof", "Sports Watch Water-Resistant 5ATM"],
    ["water resistant", "Hiking Backpack Waterproof 40L"],
    ["waterproof", "Outdoor Speaker IP67 Portable"],
    ["leak proof", "Kids Water Bottle Spill Proof Straw"],
    ["leakproof", "Lunch Box Anti-Leak Bento"],
    ["silent", "Wireless Mouse Mute Click 2.4G"],
    ["quiet", "Silent Wireless Mouse Rechargeable"],
    ["silent", "Noiseless Desk Fan USB"],
    ["wireless charging", "Qi Wireless Charge Pad 15W"],
    ["heart rate", "Smart Band Heartrate Blood Oxygen"],
    ["heart rate", "Fitness Tracker Pulse Monitor Sleep"],
    ["motion sensor", "PIR Night Light Plug In"],
    ["motion sensor", "Human Body Induction LED Lamp"],
    ["motion sensor", "Motion Activated Closet Light"],
    ["motion sensor", "Wireless Body Sensor Light Stairs"],
    ["noise cancelling", "ANC Wireless Earbuds Bluetooth 5.3"],
    ["noise cancelling", "Active Noise Cancellation Headphones"],
    ["noise canceling", "Noise Cancelling Headphones Over Ear"],
    ["fast charging", "PD 20W USB C Charger"],
    ["fast charging", "QC3.0 Car Charger Dual Port"],
    ["fast charge", "Quick Charge 3.0 Wall Adapter"],
    ["foldable", "Folding Laptop Stand Aluminum"],
    ["foldable", "Collapsible Silicone Bowl Travel"],
  ])("synonym group: %s accepts %j", (en, title) => {
    expect(requirementMatches(title, req(en))).toBe(true);
  });

  it.each([
    ["waterproof", "Stainless Water Bottle 1L"],
    ["leak proof", "Kids Water Bottle With Straw"],
    ["silent", "RGB Gaming Mouse 7200 DPI"],
    ["wireless charging", "Wireless Mouse Keyboard Combo USB Charging Cable"],
    ["heart rate", "Heart Shaped Pendant Necklace Gold"],
    ["motion sensor", "Dusk to Dawn Sensor Light"],
    ["noise cancelling", "Noise Reduction Microphone"],
    ["fast charging", "Fast Delivery USB Cable"],
    ["foldable", "A4 File Folder Organizer"],
  ])("synonym group: %s rejects %j", (en, title) => {
    expect(requirementMatches(title, req(en))).toBe(false);
  });
});

describe("requirementPhrases and normalizePhrase", () => {
  it("adds the code synonyms of any phrase once", () => {
    const phrases = requirementPhrases(req("quiet", ["silent"]));
    expect(phrases).toEqual(["quiet", "silent", "mute", "noiseless"]);
    expect(requirementPhrases(req("usb cable"))).toEqual(["usb cable"]);
  });

  it("normalizes phrasings of the same phrase alike", () => {
    expect(normalizePhrase("Wireless Chargers")).toBe(normalizePhrase("wireless charging"));
    expect(normalizePhrase("65 W")).toBe("65w");
    expect(normalizePhrase("Type-C Cables")).toBe("usbc cable");
  });
});
