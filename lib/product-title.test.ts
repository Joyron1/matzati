import { describe, expect, it } from "vitest";
import { hasHebrew, productTitleView } from "./product-title";

// A hot product's title as AliExpress sent it (probe of 2026-09-28): Hebrew with Latin and numbers.
const MACHINE_HE = "כיסוי טלפון בעיצוב פרחוני לאייפון 17, 18 פרו מקס";
const EN = "Floral Phone Case for iPhone 17 18 Pro Max";

describe("hasHebrew", () => {
  it("finds a Hebrew letter anywhere, also next to Latin text and numbers", () => {
    expect(hasHebrew(MACHINE_HE)).toBe(true);
    expect(hasHebrew("מקלט USB Bluetooth 5.0")).toBe(true);
    expect(hasHebrew("USB Bluetooth 5.0 מקלט")).toBe(true);
    expect(hasHebrew(EN)).toBe(false);
    expect(hasHebrew("")).toBe(false);
  });
});

describe("productTitleView", () => {
  it("shows our Hebrew title with AliExpress's English one under it", () => {
    expect(productTitleView("כיסוי לאייפון 17", EN)).toEqual({
      text: "כיסוי לאייפון 17",
      ltr: false,
      original: EN,
      machineTranslated: false,
    });
  });

  it("shows an English-only title left to right, with nothing under it", () => {
    expect(productTitleView(EN, EN)).toEqual({
      text: EN,
      ltr: true,
      original: null,
      machineTranslated: false,
    });
  });

  it("shows AliExpress's Hebrew title (a hot product, no title of ours) right to left, labelled", () => {
    // It used to go into <bdi dir="ltr">, which reversed "17, 18" and the words around them.
    expect(productTitleView(MACHINE_HE, MACHINE_HE)).toEqual({
      text: MACHINE_HE,
      ltr: false,
      original: null,
      machineTranslated: true,
    });
  });

  it("never shows a Hebrew AliExpress title as the English original", () => {
    expect(productTitleView("כיסוי לאייפון", MACHINE_HE)).toMatchObject({
      text: "כיסוי לאייפון",
      original: null,
      machineTranslated: false,
    });
  });
});
