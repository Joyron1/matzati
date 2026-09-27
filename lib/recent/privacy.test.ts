import { describe, expect, it } from "vitest";
import { isListableQuery } from "./privacy";

describe("isListableQuery", () => {
  it.each([
    "מטען 65W",
    "אוזניות עד 100 ש״ח",
    "בין 80 ל־200 ש״ח",
    "גלקסי S24",
    "כבל USB-C 2 מטר",
    "1080p",
    "20000mAh",
    "מקדחה 18V",
    "אוזניות לריצה, עמידות למים, עד 100 ש״ח",
    "סוללת גיבוי 20000 מיליאמפר עם כבל מובנה",
    "בלוטות' 5.3",
    "טלוויזיה 55 אינץ' 4K 120Hz",
    "iPhone 15 pro max 256gb",
    "כיסוי לגלקסי A55 5G",
    "מסך 27 2560x1440",
    "אוזניות 100-200 ש״ח",
    "מתאם 3.5mm",
    "מחשב נייד RTX 4060 8GB 2024",
    "Wi-Fi 6 נתב",
  ])("lists a real product query: %s", (query) => {
    expect(isListableQuery(query)).toBe(true);
  });

  it.each([
    ["mobile with dashes", "050-123-4567"],
    ["mobile", "0501234567"],
    ["international", "+972 50 123 4567"],
    ["international with dashes", "+972-50-1234567"],
    ["dots", "050.123.4567"],
    ["slash", "050/1234567"],
    ["in a sentence", "מטען לטלפון שלי 0501234567 דחוף"],
    ["ID number", "123456789"],
    ["ID with a check digit", "ת.ז. 12345678-9"],
    ["card number", "4580 1234 5678 9012"],
    ["en dashes", "054\u2013123\u20134567"],
    ["em dashes", "054\u2014123\u20144567"],
    ["maqaf", "054\u05BE123\u05BE4567"],
    ["commas", "054,123,4567"],
    ["underscores", "054_123_4567"],
    ["brackets", "(054)(123)(4567)"],
    ["asterisks", "4580*1234*5678*9012"],
    ["soft hyphens", "054\u00AD123\u00AD4567"],
    ["spaced wide apart", "054     123     4567"],
    ["fullwidth digits", "\uFF10\uFF15\uFF14\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17"],
    ["Arabic-Indic digits", "\u0660\u0665\u0664\u0661\u0662\u0663\u0664\u0665\u0666\u0667"],
  ])("rejects a long number (%s)", (_name, query) => {
    expect(isListableQuery(query)).toBe(false);
  });

  it.each([
    ["email", "dani@gmail.com"],
    ["email in a sentence", "שלחו לי ל dani.cohen@walla.co.il"],
    ["handle", "@dani_shop"],
    ["Hebrew handle", "@דני"],
    ["lone at sign", "אוזניות @ 100"],
    ["fullwidth at sign", "dani\uFF20gmail"],
    ["small at sign", "dani\uFE6Bgmail"],
  ])("rejects an @ (%s)", (_name, query) => {
    expect(isListableQuery(query)).toBe(false);
  });

  it.each([
    ["https link", "https://aliexpress.com/item/1005001234.html"],
    ["http link", "http://example.org"],
    ["www", "www.shop"],
    ["domain", "myshop.co.il"],
    ["upper-case domain", "SHOP.COM"],
    ["short link", "bit.ly/abc"],
    ["telegram", "t.me/deals"],
    ["whatsapp", "wa.me/972"],
    ["domain after an underscore", "x_shop.com"],
    ["domain in Hebrew text", "משהו כמו באתר ksp.co.il"],
    ["any country ending", "example.de"],
    ["another ending", "shop.fr"],
    ["short link with a path", "x.tk/abc"],
    ["fullwidth dot", "example\uFF0Ecom"],
    ["domain before Hebrew", "shop.comפרטים"],
  ])("rejects a link (%s)", (_name, query) => {
    expect(isListableQuery(query)).toBe(false);
  });

  it("rejects queries shorter than 2 or longer than 120 characters, after trimming", () => {
    expect(isListableQuery("א")).toBe(false);
    expect(isListableQuery("   א   ")).toBe(false);
    expect(isListableQuery("")).toBe(false);
    expect(isListableQuery("אב")).toBe(true);
    expect(isListableQuery(`  ${"א".repeat(120)}  `)).toBe(true);
    expect(isListableQuery("א".repeat(121))).toBe(false);
  });

  it("allows short numbers and decimals that are specs, not identifiers", () => {
    expect(isListableQuery("מטען 20W 2 יציאות")).toBe(true);
    expect(isListableQuery("שעון 1.43 אינץ'")).toBe(true);
    expect(isListableQuery("123456 חלקים")).toBe(true);
  });
});
