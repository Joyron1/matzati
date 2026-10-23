import { describe, expect, it } from "vitest";
import { rejectReason } from "@/lib/ranking/rank";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { filtersKey } from "./cache-key";
import { applyCategoryRules, childAgeFrom } from "./category-rules";
import type { ParsedQuery } from "./filters";

const NECKLACE: ParsedQuery = {
  keywords_en: "moissanite necklace gold",
  product_terms: ["moissanite necklace", "necklace"],
  requirements: [
    { en: "moissanite", alt: [], he: "מוסנייט" },
    { en: "yellow gold", alt: ["gold"], he: "זהב צהוב" },
  ],
  sort_preference: "best_value",
  product_he: "שרשרת מוסנייט",
  category_guess: ["36"],
};

const CAR: ParsedQuery = {
  keywords_en: "remote control car",
  product_terms: ["remote control car", "rc car"],
  requirements: [],
  sort_preference: "best_value",
  product_he: "מכונית על שלט",
  category_guess: ["26"],
};

function product(title: string): AliProduct {
  return {
    productId: "1",
    title,
    price: 50,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 98,
    unitsSold: 500,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: "https://www.aliexpress.com/item/1.html",
    promotionLink: "https://s.click.aliexpress.com/e/_t",
    shop: { id: "s", name: null, url: null },
    commissionRatePct: 5,
    category: { firstId: "36", firstName: null, secondId: null, secondName: null },
  };
}

describe("jewelry", () => {
  it("leaves a plain gold search as it is and says what gold usually means", () => {
    const r = applyCategoryRules(NECKLACE, "שרשרת מוסנייט בזהב צהוב");
    expect(r.requirements).toEqual(NECKLACE.requirements);
    expect(r.category_notes?.[0]).toMatch(/ציפוי זהב/);
    expect(rejectReason(product("Moissanite Necklace 18K Yellow Gold Plated"), r)).toBeNull();
  });

  it("makes real gold strict: plated, filled and gold color fail", () => {
    const r = applyCategoryRules(NECKLACE, "שרשרת מוסנייט בזהב צהוב 14 קראט");
    const gold = r.requirements[1];
    expect(gold.not).toContain("plated");
    expect(gold.he).toBe("זהב צהוב אמיתי");
    expect(rejectReason(product("Moissanite Necklace 14K Solid Yellow Gold"), r)).toBeNull();
    for (const t of [
      "Moissanite Necklace 18K Yellow Gold Plated",
      "Moissanite Necklace 14K Yellow Gold Filled",
      "Moissanite Necklace Yellow Gold Color Chain",
    ]) {
      expect(rejectReason(product(t), r)).toBe("requirement");
    }
    // A strict search never shares cached results with the plain one.
    expect(filtersKey(r, "none")).not.toBe(filtersKey(NECKLACE, "none"));
  });

  it("adds a real-gold requirement when the parse had none", () => {
    const plain = { ...NECKLACE, requirements: [NECKLACE.requirements[0]] };
    const r = applyCategoryRules(plain, "שרשרת מוסנייט זהב אמיתי");
    expect(r.requirements.map((q) => q.en)).toEqual(["moissanite", "solid gold"]);
  });

  it("makes 925 silver strict", () => {
    const silver = {
      ...NECKLACE,
      requirements: [NECKLACE.requirements[0], { en: "silver", alt: [], he: "כסף" }],
    };
    const r = applyCategoryRules(silver, "שרשרת מוסנייט כסף 925");
    expect(rejectReason(product("Moissanite Necklace S925 Sterling Silver"), r)).toBeNull();
    expect(rejectReason(product("Moissanite Necklace Silver Plated"), r)).toBe("requirement");
  });

  it("does nothing outside jewelry", () => {
    const tools = { ...NECKLACE, category_guess: ["1420"] };
    expect(applyCategoryRules(tools, "זהב 14 קראט")).toBe(tools);
  });
});

describe("kids", () => {
  it("reads a child's age, never a birthday number, size or price", () => {
    expect(childAgeFrom("מכונית על שלט לילד בן 5")).toBe(5);
    expect(childAgeFrom("משחק לבת 8")).toBe(8);
    expect(childAgeFrom("בלונים ליום הולדת בן 5")).toBeNull();
    expect(childAgeFrom("מכונית על שלט עד 100 ש״ח")).toBeNull();
    expect(childAgeFrom("לגיל 40")).toBeNull();
  });

  it("keeps out toys stated for older children", () => {
    const r = applyCategoryRules(CAR, "מכונית על שלט לילד בן 5");
    expect(r.child_age).toBe(5);
    expect(r.category_notes?.[0]).toMatch(/מבוגר מ־5/);
    expect(rejectReason(product("Remote Control Car 14+ Years Drift"), r)).toBe("requirement");
    expect(rejectReason(product("Remote Control Car for Kids 3-6 Years"), r)).toBeNull();
    expect(rejectReason(product("Remote Control Car Drift"), r)).toBeNull();
  });
});

describe("clothing", () => {
  it("turns a size into a preference and says to check the size chart", () => {
    const shoes: ParsedQuery = {
      keywords_en: "running shoes",
      product_terms: ["running shoes"],
      requirements: [{ en: "size 42", alt: ["42"], he: "מידה 42" }],
      sort_preference: "best_value",
      product_he: "נעלי ריצה",
      category_guess: ["322"],
    };
    const r = applyCategoryRules(shoes, "נעלי ריצה מידה 42");
    expect(r.requirements).toEqual([]);
    expect(r.preferences?.map((p) => p.he)).toEqual(["מידה 42"]);
    expect(r.category_notes?.[0]).toMatch(/טבלת המידות/);
  });
});

describe("no category", () => {
  it("returns the parse itself", () => {
    const none = { ...CAR, category_guess: undefined };
    expect(applyCategoryRules(none, "מכונית על שלט לילד בן 5")).toBe(none);
  });
});
