import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { requirementMatches } from "@/lib/ranking/match";
import { isRequestedProduct } from "@/lib/ranking/type-gate";
import {
  normalizeParsed,
  normalizeParsedWithFixes,
  PARSE_SYSTEM,
  parseQuery,
  parsedQuerySchema,
  type ParsedQueryRaw,
} from "./parse";
import type { LlmProvider, LlmUsage, StructuredRequest } from "./provider";

function raw(over: Partial<ParsedQueryRaw> = {}): ParsedQueryRaw {
  return {
    product_he: "מנורת שולחן",
    product_terms: ["desk lamp", "table lamp"],
    requirements: [{ en: "foldable", alt: ["folding"], he: "מתקפלת" }],
    keywords_en: "foldable desk lamp",
    min_price_ils: null,
    max_price_ils: 120,
    sort_preference: "best_value",
    category_hint: "office lighting",
    ...over,
  };
}

const req = (en: string, alt: string[] = [], he = "דרישה") => ({ en, alt, he });

describe("normalizeParsed", () => {
  it("passes a clean parse through unchanged", () => {
    expect(normalizeParsed(raw())).toEqual({
      keywords_en: "foldable desk lamp",
      product_terms: ["desk lamp", "table lamp"],
      requirements: [{ en: "foldable", alt: ["folding"], he: "מתקפלת" }],
      max_price_ils: 120,
      sort_preference: "best_value",
      product_he: "מנורת שולחן",
      category_hint: "office lighting",
    });
  });

  describe("keywords_en", () => {
    it("trims, lowercases and collapses whitespace", () => {
      const p = normalizeParsed(raw({ keywords_en: "  Foldable   Desk\tLAMP " }));
      expect(p?.keywords_en).toBe("foldable desk lamp");
    });

    it("drops repeated words and commas", () => {
      const p = normalizeParsed(raw({ keywords_en: "desk lamp, desk Lamp" }));
      expect(p?.keywords_en).toBe("desk lamp");
    });

    it("glues a number to its unit", () => {
      expect(normalizeParsed(raw({ keywords_en: "20000 mAh power bank" }))?.keywords_en).toBe(
        "20000mah power bank",
      );
      expect(normalizeParsed(raw({ keywords_en: "144 Hz monitor" }))?.keywords_en).toBe(
        "144hz monitor",
      );
    });

    it("does not glue a number to an ordinary word", () => {
      expect(normalizeParsed(raw({ keywords_en: "galaxy s24 case 2 pack" }))?.keywords_en).toBe(
        "galaxy s24 case 2 pack",
      );
    });

    it("accepts one word and up to six", () => {
      expect(normalizeParsed(raw({ keywords_en: "lantern" }))?.keywords_en).toBe("lantern");
      expect(normalizeParsed(raw({ keywords_en: "a b c d e f" }))?.keywords_en).toBe("a b c d e f");
    });

    it("rejects empty or blank keywords", () => {
      expect(normalizeParsed(raw({ keywords_en: "" }))).toBeNull();
      expect(normalizeParsed(raw({ keywords_en: "  , " }))).toBeNull();
    });

    it("rejects more than six words", () => {
      expect(normalizeParsed(raw({ keywords_en: "a b c d e f g" }))).toBeNull();
    });

    it("counts words after removing repeats", () => {
      expect(
        normalizeParsed(raw({ keywords_en: "lamp lamp lamp lamp lamp lamp lamp" })),
      ).not.toBeNull();
    });
  });

  describe("product_terms", () => {
    it("lowercases, trims and drops empty terms", () => {
      const p = normalizeParsed(raw({ product_terms: [" Yoga Mat ", "", "  ", "Exercise  Mat"] }));
      expect(p?.product_terms).toEqual(["yoga mat", "exercise mat"]);
    });

    it("dedupes terms that differ only by case, spacing or hyphens", () => {
      const p = normalizeParsed(
        raw({ product_terms: ["power bank", "Power-Bank", "power  bank"] }),
      );
      expect(p?.product_terms).toEqual(["power bank"]);
    });

    it("keeps a one-word spelling next to the spaced one", () => {
      const p = normalizeParsed(raw({ product_terms: ["smart watch", "smartwatch"] }));
      expect(p?.product_terms).toEqual(["smart watch", "smartwatch"]);
    });

    it("keeps at most four", () => {
      const p = normalizeParsed(raw({ product_terms: ["a1", "b2", "c3", "d4", "e5"] }));
      expect(p?.product_terms).toEqual(["a1", "b2", "c3", "d4"]);
    });

    it("rejects a parse without a product term", () => {
      expect(normalizeParsed(raw({ product_terms: [] }))).toBeNull();
      expect(normalizeParsed(raw({ product_terms: ["", " "] }))).toBeNull();
    });
  });

  describe("requirements", () => {
    it("lowercases every phrase and trims the Hebrew label", () => {
      const p = normalizeParsed(
        raw({
          requirements: [req(" Noise Cancelling ", ["ANC", "Noise  Reduction"], " סינון רעשים ")],
        }),
      );
      expect(p?.requirements).toEqual([
        { en: "noise cancelling", alt: ["anc", "noise reduction"], he: "סינון רעשים" },
      ]);
    });

    it("writes a numeric spec without a space", () => {
      const p = normalizeParsed(raw({ requirements: [req("20000 mAh", [], "20000mAh")] }));
      expect(p?.requirements[0].en).toBe("20000mah");
    });

    it("drops alt phrases that repeat en or each other", () => {
      const p = normalizeParsed(
        raw({ requirements: [req("non slip", ["Non-Slip", "anti slip", "anti-slip", ""])] }),
      );
      expect(p?.requirements[0]).toMatchObject({ en: "non slip", alt: ["anti slip"] });
    });

    it("keeps at most three alt phrases", () => {
      const p = normalizeParsed(raw({ requirements: [req("foldable", ["a1", "b2", "c3", "d4"])] }));
      expect(p?.requirements[0].alt).toEqual(["a1", "b2", "c3"]);
    });

    it("promotes the first alt when en is empty", () => {
      const p = normalizeParsed(raw({ requirements: [req(" ", ["folding", "collapsible"])] }));
      expect(p?.requirements).toEqual([{ en: "folding", alt: ["collapsible"], he: "דרישה" }]);
    });

    it("drops a requirement with no phrase at all", () => {
      const p = normalizeParsed(raw({ requirements: [req("", ["", " "]), req("dimmable")] }));
      expect(p?.requirements.map((r) => r.en)).toEqual(["dimmable"]);
    });

    it("falls back to the English phrase when the Hebrew label is empty", () => {
      const p = normalizeParsed(raw({ requirements: [req("dimmable", [], "  ")] }));
      expect(p?.requirements[0].he).toBe("dimmable");
    });

    it("keeps one requirement per en phrase, so chip ids stay unique", () => {
      const p = normalizeParsed(
        raw({ requirements: [req("foldable", ["folding"]), req("Foldable", ["collapsible"])] }),
      );
      expect(p?.requirements).toEqual([{ en: "foldable", alt: ["folding"], he: "דרישה" }]);
    });

    it("keeps at most three requirements", () => {
      const p = normalizeParsed(
        raw({ requirements: [req("dimmable"), req("foldable"), req("rechargeable"), req("usb")] }),
      );
      expect(p?.requirements.map((r) => r.en)).toEqual(["dimmable", "foldable", "rechargeable"]);
    });

    it("drops a requirement that only repeats the product", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["smartwatch", "smart watch"],
          requirements: [req("smart", ["watch"]), req("heart rate", ["pulse"])],
        }),
      );
      expect(p?.requirements.map((r) => r.en)).toEqual(["heart rate"]);
    });

    it("keeps a requirement that only some product terms say", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["wireless earbuds", "earbuds", "earphones"],
          requirements: [req("wireless", [], "אלחוטיות")],
        }),
      );
      expect(p?.requirements.map((r) => r.en)).toEqual(["wireless"]);
    });

    it("keeps a word hidden inside a lone one-word product term", () => {
      const p = normalizeParsed(
        raw({ product_terms: ["microphone"], requirements: [req("phone", [], "לטלפון")] }),
      );
      expect(p?.requirements.map((r) => r.en)).toEqual(["phone"]);
    });

    it("drops only the phrases a product term already contains", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["led strip"],
          requirements: [req("led", ["waterproof led", "ip65"])],
        }),
      );
      expect(p?.requirements[0]).toMatchObject({ en: "waterproof led", alt: ["ip65"] });
    });

    it("treats a product term written as one word like its spaced form", () => {
      const p = normalizeParsed(
        raw({ product_terms: ["powerbank"], requirements: [req("power bank"), req("20000mah")] }),
      );
      expect(p?.requirements.map((r) => r.en)).toEqual(["20000mah"]);
    });

    it("compares whole words, so a connector type survives a cable product term", () => {
      const p = normalizeParsed(
        raw({ product_terms: ["usb cable"], requirements: [req("usb c", ["type c"])] }),
      );
      expect(p?.requirements[0]).toMatchObject({ en: "usb c", alt: ["type c"] });
    });

    it("keeps a requirement that is longer than a product term", () => {
      const p = normalizeParsed(
        raw({ product_terms: ["lamp"], requirements: [req("lamp with clamp")] }),
      );
      expect(p?.requirements.map((r) => r.en)).toEqual(["lamp with clamp"]);
    });

    it("allows no requirements", () => {
      expect(normalizeParsed(raw({ requirements: [] }))?.requirements).toEqual([]);
    });
  });

  describe("prices", () => {
    it("leaves out null bounds", () => {
      const p = normalizeParsed(raw({ min_price_ils: null, max_price_ils: null }));
      expect(p).not.toBeNull();
      expect(p).not.toHaveProperty("min_price_ils");
      expect(p).not.toHaveProperty("max_price_ils");
    });

    it("keeps both bounds of a range", () => {
      const p = normalizeParsed(raw({ min_price_ils: 40, max_price_ils: 90 }));
      expect(p).toMatchObject({ min_price_ils: 40, max_price_ils: 90 });
    });

    it("swaps inverted bounds", () => {
      const p = normalizeParsed(raw({ min_price_ils: 300, max_price_ils: 250 }));
      expect(p).toMatchObject({ min_price_ils: 250, max_price_ils: 300 });
    });

    it("drops zero, negative and non-finite bounds", () => {
      for (const bad of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
        const p = normalizeParsed(raw({ min_price_ils: bad, max_price_ils: bad }));
        expect(p).not.toHaveProperty("min_price_ils");
        expect(p).not.toHaveProperty("max_price_ils");
      }
    });

    it("keeps a single min bound", () => {
      const p = normalizeParsed(raw({ min_price_ils: 250, max_price_ils: null }));
      expect(p?.min_price_ils).toBe(250);
      expect(p).not.toHaveProperty("max_price_ils");
    });
  });

  describe("labels and hints", () => {
    it("collapses whitespace in the Hebrew product label", () => {
      expect(normalizeParsed(raw({ product_he: "  פנס   לקמפינג " }))?.product_he).toBe(
        "פנס לקמפינג",
      );
    });

    it("turns ASCII quotes in Hebrew abbreviations into gershayim and geresh", () => {
      expect(normalizeParsed(raw({ product_he: 'סרגל 30 ס"מ' }))?.product_he).toBe("סרגל 30 ס״מ");
      expect(normalizeParsed(raw({ product_he: "מסך 27 אינץ'" }))?.product_he).toBe("מסך 27 אינץ׳");
      const p = normalizeParsed(raw({ requirements: [req("zipper", [], "עם ריצ'רץ'")] }));
      expect(p?.requirements[0].he).toBe("עם ריצ׳רץ׳");
    });

    it("leaves quotes around Latin text alone", () => {
      expect(normalizeParsed(raw({ product_he: 'מסך "4K"' }))?.product_he).toBe('מסך "4K"');
    });

    it("falls back to the first product term when the Hebrew label is empty", () => {
      expect(normalizeParsed(raw({ product_he: " " }))?.product_he).toBe("desk lamp");
    });

    it("lowercases the category hint and drops a blank one", () => {
      expect(normalizeParsed(raw({ category_hint: " Office  Lighting " }))?.category_hint).toBe(
        "office lighting",
      );
      expect(normalizeParsed(raw({ category_hint: "  " }))).not.toHaveProperty("category_hint");
      expect(normalizeParsed(raw({ category_hint: null }))).not.toHaveProperty("category_hint");
    });

    it("keeps the sort preference", () => {
      for (const s of ["best_value", "cheapest", "most_popular"] as const) {
        expect(normalizeParsed(raw({ sort_preference: s }))?.sort_preference).toBe(s);
      }
    });

    it("fixes the Hebrew misspelling the model produced (eval round 2)", () => {
      const p = normalizeParsed(
        raw({
          product_he: "בקבוק אטום לדיסות",
          requirements: [req("leak proof", ["no leak"], "אטום לדיסות")],
        }),
      );
      expect(p?.product_he).toBe("בקבוק אטום לדליפות");
      expect(p?.requirements[0].he).toBe("אטום לדליפות");
      // Only the whole word: a word that merely contains the letters stays as it is.
      expect(normalizeParsed(raw({ product_he: "פרדיסות" }))?.product_he).toBe("פרדיסות");
    });

    it("fixes the shopper's typo the model copied into a label (eval round 3, typo-earbuds)", () => {
      const p = normalizeParsed(
        raw({
          product_he: "אוזניות בלוטות לריצה",
          product_terms: ["running headphones"],
          requirements: [req("waterproof", ["water resistant"], "עמידות למיים")],
        }),
        "אוזניות בלוטות לריצה עמידות למיים",
      );
      expect(p?.product_he).toBe("אוזניות בלוטוס לריצה");
      expect(p?.requirements[0].he).toBe("עמידות למים");
    });
  });

  describe("requirements a title can state (docs/search-quality-plan.md A8)", () => {
    // Recorded parses: eval round 3 (fixtures/llm/eval-v3-2026-09-27*.json) and the snapshots.
    it("drops an alt that means something else than its requirement", () => {
      const holder = normalizeParsed(
        raw({
          product_terms: ["car phone holder", "phone mount"],
          requirements: [
            req("wireless charging", ["qi charging", "fast charging"], "טעינה אלחוטית"),
          ],
        }),
      );
      expect(holder?.requirements[0]).toMatchObject({
        en: "wireless charging",
        alt: ["qi charging"],
      });
      const mouse = normalizeParsed(
        raw({
          product_terms: ["gaming mouse"],
          requirements: [req("silent", ["quiet", "noise cancelling"])],
        }),
      );
      expect(mouse?.requirements[0].alt).toEqual(["quiet"]);
      const slippers = normalizeParsed(
        raw({
          product_terms: ["house slippers"],
          requirements: [req("warm", ["heated", "thermal"])],
        }),
      );
      expect(slippers?.requirements[0].alt).toEqual(["thermal"]);
    });

    it("drops an alt that is one word of a longer requirement", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["night light"],
          requirements: [req("motion sensor", ["sensor", "pir"])],
        }),
      );
      expect(p?.requirements[0]).toMatchObject({ en: "motion sensor", alt: ["pir"] });
    });

    it("keeps alts of the same meaning and phrases with no known group", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["bluetooth speaker"],
          requirements: [req("waterproof", ["water resistant", "ipx7", "water repellent"])],
        }),
      );
      expect(p?.requirements[0].alt).toEqual(["water resistant", "ipx7", "water repellent"]);
    });

    it("turns a description no seller writes into a preference, without its chip", () => {
      const charger = normalizeParsedWithFixes(
        raw({
          product_he: "מטען מהיר 65W",
          product_terms: ["fast charger", "65w charger", "power adapter"],
          requirements: [
            req("65w", [], "65W"),
            req("multi-device", ["laptop and phone", "universal"], "לטלפון ולמחשב נייד"),
          ],
          keywords_en: "65w fast charger",
        }),
      );
      expect(charger.parsed?.requirements.map((r) => r.en)).toEqual(["65w"]);
      expect(charger.fixes).toContainEqual({
        kind: "requirement_dropped",
        requirement: "multi-device",
        he: "לטלפון ולמחשב נייד",
      });
      // Not a filter, but not lost: its title words raise relevance and the page names it.
      expect(charger.parsed?.preferences).toEqual([
        { words: ["laptop", "phone"], he: "לטלפון ולמחשב נייד" },
      ]);
      const pillow = normalizeParsed(
        raw({
          product_terms: ["neck pillow"],
          requirements: [req("for long flights", [], "לטיסות ארוכות")],
        }),
      );
      expect(pillow?.requirements).toEqual([]);
      expect(pillow?.preferences).toEqual([{ words: ["long", "flights"], he: "לטיסות ארוכות" }]);
      // A parse without such a need has no preferences field at all.
      expect(normalizeParsed(raw({ product_terms: ["neck pillow"] }))).not.toHaveProperty(
        "preferences",
      );
    });

    it("keeps the seller phrase inside a description", () => {
      const watch = normalizeParsed(
        raw({
          product_terms: ["smartwatch", "smart watch"],
          requirements: [
            req("heart rate monitor", ["heart rate sensor", "pulse monitor"], "מד דופק"),
          ],
        }),
      );
      expect(watch?.requirements).toEqual([
        { en: "heart rate", alt: ["pulse monitor"], he: "מד דופק" },
      ]);
      const cable = normalizeParsed(
        raw({
          product_terms: ["usb-c cable"],
          requirements: [
            req("iphone 15 compatible", ["iphone 15", "for iphone 15"], "תואם אייפון 15"),
          ],
        }),
      );
      expect(cable?.requirements).toEqual([{ en: "iphone 15", alt: [], he: "תואם אייפון 15" }]);
    });

    it("keeps short seller phrases, numeric specs and two words joined by 'with'", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["desk lamp"],
          requirements: [
            req("rechargeable", ["usb charging", "built-in battery"]),
            req("20000 mAh"),
            req("lamp with clamp"),
          ],
        }),
      );
      expect(p?.requirements.map((r) => [r.en, ...r.alt])).toEqual([
        ["rechargeable", "usb charging", "built-in battery"],
        ["20000mah"],
        ["lamp with clamp"],
      ]);
    });
  });

  describe("product terms name the plain product", () => {
    it("turns gift terms into a set of the named interest (eval round 3, gift-cook)", () => {
      const { parsed, fixes } = normalizeParsedWithFixes(
        raw({
          product_he: "מתנה לאבא בישול",
          product_terms: ["cooking gift", "kitchen gift", "chef gift set"],
          requirements: [],
          keywords_en: "cooking kitchen gift",
        }),
        "מתנה לאבא שאוהב לבשל עד 200 ש״ח",
      );
      expect(parsed?.product_terms).toEqual(["cooking set", "kitchen set", "chef set"]);
      expect(parsed?.keywords_en).toBe("cooking kitchen set");
      expect(fixes).toContainEqual({ kind: "gift_term", from: "cooking gift", to: "cooking set" });
    });

    it("drops a gift term that names no product, and keeps gift packaging", () => {
      const p = normalizeParsed(
        raw({ product_terms: ["gift for dad", "bbq tools set"], keywords_en: "bbq tools" }),
      );
      expect(p?.product_terms).toEqual(["bbq tools set"]);
      const box = normalizeParsed(
        raw({ product_terms: ["gift box", "gift bag"], keywords_en: "gift box" }),
      );
      expect(box?.product_terms).toEqual(["gift box", "gift bag"]);
      expect(box?.keywords_en).toBe("gift box");
      // Nothing left: the model's terms stay rather than failing the search.
      const only = normalizeParsed(
        raw({ product_terms: ["birthday gift"], keywords_en: "birthday gift" }),
      );
      expect(only?.product_terms).toEqual(["birthday gift"]);
    });

    it("adds the product without its audience when two words still name it", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["kids water bottle", "children's bottle"],
          keywords_en: "kids water bottle",
        }),
      );
      expect(p?.product_terms).toEqual(["kids water bottle", "children's bottle", "water bottle"]);
      expect(normalizeParsed(raw({ product_terms: ["baby monitor"] }))?.product_terms).toEqual([
        "baby monitor",
      ]);
    });

    it("adds a plain noun that names one kind of product", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["running earbuds", "sports earbuds", "running headphones"],
          requirements: [req("waterproof", ["water resistant"])],
        }),
      );
      expect(p?.product_terms).toEqual([
        "running earbuds",
        "sports earbuds",
        "running headphones",
        "earbuds",
        "headphones",
      ]);
      // Not a noun that names other things too.
      expect(normalizeParsed(raw({ product_terms: ["travel pillow"] }))?.product_terms).toEqual([
        "travel pillow",
      ]);
    });

    it("keeps the audience of a plain product: kids headphones are not any headphones", () => {
      // "אוזניות לילדים" and "שעון חכם לילדים": a plain noun would let every adult product pass.
      expect(
        normalizeParsed(
          raw({ product_terms: ["kids headphones", "children's headphones"] }),
          "אוזניות לילדים",
        )?.product_terms,
      ).toEqual(["kids headphones", "children's headphones"]);
      expect(
        normalizeParsed(raw({ product_terms: ["kids smartwatch"] }), "שעון חכם לילדים")
          ?.product_terms,
      ).toEqual(["kids smartwatch"]);
    });

    it("does not turn a word every model term says into a requirement", () => {
      const p = normalizeParsed(
        raw({
          product_terms: ["wireless earbuds"],
          requirements: [req("wireless", [], "אלחוטיות")],
        }),
      );
      expect(p?.product_terms).toEqual(["wireless earbuds", "earbuds"]);
      expect(p?.requirements).toEqual([]);
    });
  });

  describe("גן means kindergarten", () => {
    // Recorded round 2: "בקבוק מים לגן שלא נוזל" gave the product term "garden bottle".
    const bottle = raw({
      product_he: "בקבוק מים לגן",
      product_terms: ["water bottle", "garden bottle"],
      requirements: [req("leak proof", ["no leak"], "אטום לדליפות")],
      keywords_en: "leak proof water bottle",
      max_price_ils: null,
      category_hint: "children water bottles",
    });

    it("drops garden phrases from a request about a kindergarten", () => {
      const p = normalizeParsed(bottle, "בקבוק מים לגן שלא נוזל");
      expect(p?.product_terms).toEqual(["water bottle"]);
      expect(p?.keywords_en).toBe("leak proof water bottle");
      const worse = normalizeParsed(
        { ...bottle, keywords_en: "garden water bottle", category_hint: "garden bottles" },
        "בקבוק לגן הילדים",
      );
      expect(worse?.keywords_en).toBe("water bottle");
      expect(worse?.category_hint).toBe("bottles");
      expect(normalizeParsed(bottle, "תיק גב קטן לגן ילדים")?.product_terms).toEqual([
        "water bottle",
      ]);
    });

    it("keeps garden when the request is about a garden", () => {
      const tools = raw({
        product_terms: ["gardening tools", "garden tools"],
        keywords_en: "gardening tools set",
      });
      for (const q of [
        "מתנה לסבתא שאוהבת לגנן עד 120 ש״ח",
        "כלים לגינה",
        "ריהוט גן מעץ",
        "זרעים לגן ירק",
      ]) {
        expect([q, normalizeParsed(tools, q)?.product_terms]).toEqual([
          q,
          ["gardening tools", "garden tools"],
        ]);
      }
      // "להגן" (to protect) is not a kindergarten.
      expect(normalizeParsed(bottle, "כיסוי להגן על הבקבוק")?.product_terms).toEqual([
        "water bottle",
        "garden bottle",
      ]);
    });

    it("keeps garden for 'לגן' without a kids context: it is a garden too", () => {
      const lights = raw({
        product_he: "תאורה סולארית לגן",
        product_terms: ["solar garden light", "garden light", "solar light"],
        requirements: [],
        keywords_en: "solar garden lights",
        category_hint: "outdoor garden lighting",
      });
      const p = normalizeParsed(lights, "תאורה סולארית לגן");
      expect(p?.keywords_en).toBe("solar garden lights");
      expect(p?.product_terms).toEqual(["solar garden light", "garden light", "solar light"]);
      expect(p?.category_hint).toBe("outdoor garden lighting");
      const tools = raw({
        product_terms: ["garden tools"],
        requirements: [],
        keywords_en: "garden tools set",
        category_hint: "garden hand tools",
      });
      expect(normalizeParsed(tools, "כלי עבודה לגן")?.keywords_en).toBe("garden tools set");
    });

    it("takes the kids context from the request or from the model's own words", () => {
      const plain = { ...bottle, category_hint: "water bottles" };
      // No kids word anywhere: "לגן" could be a garden, so nothing is removed.
      expect(normalizeParsed(plain, "בקבוק מים לגן")?.product_terms).toEqual([
        "water bottle",
        "garden bottle",
      ]);
      for (const q of ["בקבוק מים לגן לילד", "בקבוק לגן לבת 4", "בקבוק לתינוק בגן"]) {
        expect([q, normalizeParsed(plain, q)?.product_terms]).toEqual([q, ["water bottle"]]);
      }
    });

    it("never drops the last product term, and needs the query to act", () => {
      const only = { ...bottle, product_terms: ["garden bottle"] };
      expect(normalizeParsed(only, "בקבוק לגן")?.product_terms).toEqual(["garden bottle"]);
      expect(normalizeParsed(bottle)?.product_terms).toEqual(["water bottle", "garden bottle"]);
    });
  });
});

describe("PARSE_SYSTEM", () => {
  it("spells out the labels and the meaning of גן that the model got wrong", () => {
    expect(PARSE_SYSTEM).toContain("אטום לדליפות");
    expect(PARSE_SYSTEM).toMatch(/גן[^\n]*kindergarten/);
  });

  it("makes a named character, franchise or brand a requirement (Sonic balloons found Pokémon)", () => {
    expect(PARSE_SYSTEM).toMatch(/character, franchise, team or brand[^\n]*requirement/);
    expect(PARSE_SYSTEM).toContain('סוניק -> "sonic"');
  });
});

describe("a number preference never narrows the product terms", () => {
  // "בלון מספר 5 זהב ליום הולדת" as the model parsed it on 2026-09-30: the number in the terms
  // turned away 61 of 119 gold number balloons.
  const five = raw({
    product_he: "בלון מספר 5 זהב",
    product_terms: ["number 5 balloon", "5 balloon"],
    requirements: [req("gold", ["golden"], "זהב")],
    preferences: [{ phrases: ["number 5", "5th birthday"], he: "מספר 5" }],
    keywords_en: "number 5 gold balloon birthday",
    max_price_ils: null,
    category_hint: "party balloons",
  });

  it("drops the number from the terms and keeps the product", () => {
    const p = normalizeParsed(five)!;
    expect(p.product_terms).toEqual(["number balloon", "balloon"]);
    expect(p.preferences?.[0]).toMatchObject({ he: "מספר 5" });
    expect(p.preferences?.[0].words).toContain("number 5");
  });

  it("lets gold number balloons through the type gate", () => {
    const p = normalizeParsed(five)!;
    for (const title of [
      "32inch Gold Number Foil Balloons 0-9 Birthday Party Decoration",
      "40 Inch Gold Number 5 Foil Balloon Happy Birthday",
      "Big Size Golden Number Balloons Anniversary Party",
    ]) {
      expect(isRequestedProduct(title, p)).toBe(true);
    }
  });

  it("keeps the number in the terms when there is no number preference", () => {
    const p = normalizeParsed(
      raw({ product_terms: ["usb c hub 7 in 1"], requirements: [], keywords_en: "usb c hub" }),
    )!;
    expect(p.product_terms[0]).toBe("usb c hub 7 in 1");
  });
});

describe("a named character as a requirement", () => {
  // "בלונים ליום הולדת 3 של סוניק" as PARSE_VERSION 7 is told to parse it.
  const sonic = raw({
    product_he: "בלונים ליום הולדת",
    product_terms: ["balloons", "party balloons"],
    requirements: [req("sonic", ["sonic the hedgehog"], "סוניק")],
    keywords_en: "sonic birthday balloons",
    max_price_ils: null,
    category_hint: "party decorations",
  });

  it("keeps a one-word name as a requirement, with its long form", () => {
    expect(normalizeParsed(sonic)?.requirements).toEqual([
      { en: "sonic", alt: ["sonic the hedgehog"], he: "סוניק" },
    ]);
  });

  it("lets through only titles that name it", () => {
    const [sonicReq] = normalizeParsed(sonic)!.requirements;
    expect(requirementMatches("Sonic The Hedgehog Birthday Party Balloons Set", sonicReq)).toBe(
      true,
    );
    expect(requirementMatches("Pokemon Pikachu Birthday Balloons Party Decoration", sonicReq)).toBe(
      false,
    );
  });
});

describe("an age or number for a birthday (PARSE_VERSION 8)", () => {
  const Q = "בלונים ליום הולדת 3 של סוניק";
  const sonic3 = raw({
    product_he: "בלונים ליום הולדת",
    product_terms: ["birthday balloons", "balloons"],
    requirements: [req("sonic", [], "סוניק")],
    preferences: [{ phrases: ["3rd birthday", "number 3", "3 year old"], he: "יום הולדת 3" }],
    keywords_en: "sonic 3rd birthday balloons",
    max_price_ils: null,
    category_hint: "party decorations",
  });

  it("tells the model: a preference with seller phrasings, and the number in the keywords", () => {
    expect(PARSE_SYSTEM).toMatch(
      /preferences: an age or number[^\n]*"3rd birthday"[^\n]*"number 3"/,
    );
    expect(PARSE_SYSTEM).toContain("sonic 3rd birthday balloons");
    expect(PARSE_SYSTEM).toMatch(/Not requirements:[^\n]*an age or number/);
    expect(Object.keys(parsedQuerySchema.shape)).toContain("preferences");
  });

  it("keeps it as a preference with the usual phrasings, never a requirement", () => {
    const p = normalizeParsed(sonic3, Q)!;
    expect(p.requirements.map((r) => r.en)).toEqual(["sonic"]);
    expect(p.keywords_en).toBe("sonic 3rd birthday balloons");
    expect(p.preferences).toEqual([
      {
        words: expect.arrayContaining([
          "3rd birthday",
          "third birthday",
          "number 3",
          "3 years",
          "3 year old",
        ]),
        he: "יום הולדת 3",
      },
    ]);
    // Every phrase names the number: never a bare word such as "birthday".
    expect(p.preferences![0].words.every((w) => /\b3|third/.test(w))).toBe(true);
  });

  it("turns an age the model made a requirement into the preference", () => {
    const { parsed, fixes } = normalizeParsedWithFixes(
      raw({
        ...sonic3,
        requirements: [req("sonic", [], "סוניק"), req("3rd birthday", ["number 3"], "יום הולדת 3")],
        preferences: [],
      }),
      Q,
    );
    expect(parsed?.requirements.map((r) => r.en)).toEqual(["sonic"]);
    expect(parsed?.preferences?.[0]).toMatchObject({ he: "יום הולדת 3" });
    expect(parsed?.preferences?.[0].words).toContain("number 3");
    expect(fixes).toContainEqual({ kind: "age_preference", from: "3rd birthday" });
  });

  it("finds the age in the Hebrew when the model left it out", () => {
    const missed = { ...sonic3, preferences: [] };
    expect(normalizeParsed(missed, Q)?.preferences).toEqual([
      { words: expect.arrayContaining(["3rd birthday", "number 3"]), he: "יום הולדת 3" },
    ]);
    expect(normalizeParsed(missed, "מסיבת יום הולדת לבת 5 עם בלונים")?.preferences?.[0]).toEqual({
      words: expect.arrayContaining(["5th birthday", "fifth birthday", "number 5"]),
      he: "גיל 5",
    });
    // Not a party: a size or a count stays out of it.
    expect(normalizeParsed(missed, "בלונים 3 מטר")?.preferences).toBeUndefined();
    // A price is never an age.
    expect(normalizeParsed(missed, "בלונים ליום הולדת עד 40 ש״ח")?.preferences).toBeUndefined();
  });

  it("takes only a number from the model's preferences, and writes ordinals right", () => {
    const noNumber = raw({ preferences: [{ phrases: ["birthday party"], he: "למסיבה" }] });
    expect(normalizeParsed(noNumber)?.preferences).toBeUndefined();
    const forty = normalizeParsed(
      raw({ preferences: [{ phrases: ["40th birthday"], he: "יום הולדת 40" }] }),
    )!;
    expect(forty.preferences?.[0].words).toEqual(
      expect.arrayContaining(["40th birthday", "number 40", "40 years"]),
    );
    const words = (n: number) =>
      normalizeParsed(raw({ preferences: [{ phrases: [`number ${n}`], he: "x" }] }))!
        .preferences![0].words;
    expect(words(1)).toContain("1st birthday");
    expect(words(2)).toContain("2nd birthday");
    expect(words(11)).toContain("11th birthday");
    expect(words(21)).toContain("21st birthday");
  });

  it("a parse recorded before version 8 (no preferences field) still normalizes", () => {
    const old: ParsedQueryRaw = { ...sonic3 };
    delete old.preferences;
    expect("preferences" in old).toBe(false);
    expect(normalizeParsed(old)?.requirements.map((r) => r.en)).toEqual(["sonic"]);
  });
});

describe("parsedQuerySchema", () => {
  it("converts to a structured-output schema with every field required", () => {
    const { schema } = zodOutputFormat(parsedQuerySchema);
    expect(schema).toMatchObject({ type: "object", additionalProperties: false });
    expect([...(schema.required as string[])].sort()).toEqual(
      Object.keys(parsedQuerySchema.shape).sort(),
    );
  });

  it("has no chip or must_have fields", () => {
    expect(Object.keys(parsedQuerySchema.shape)).not.toContain("chips_he");
    expect(Object.keys(parsedQuerySchema.shape)).not.toContain("must_have");
  });
});

const USAGE: LlmUsage = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Replays canned outputs and records every request; no network. */
function fakeLlm(outputs: (ParsedQueryRaw | null)[]) {
  const requests: StructuredRequest<typeof parsedQuerySchema>[] = [];
  const llm: LlmProvider = {
    name: "anthropic",
    model: "fake-model",
    async generateStructured<T extends z.ZodType>(r: StructuredRequest<T>) {
      requests.push(r as unknown as StructuredRequest<typeof parsedQuerySchema>);
      const data = (outputs[requests.length - 1] ?? null) as z.infer<T> | null;
      return { data, usage: USAGE, model: "fake-model-snapshot" };
    },
  };
  return { llm, requests };
}

describe("parseQuery", () => {
  it("parses in one call at temperature 0", async () => {
    const { llm, requests } = fakeLlm([raw()]);
    const res = await parseQuery(llm, "מנורת שולחן מתקפלת");
    expect(res.parsed?.keywords_en).toBe("foldable desk lamp");
    expect(res.usage).toEqual([USAGE]);
    expect(res.model).toBe("fake-model-snapshot");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      system: PARSE_SYSTEM,
      user: "מנורת שולחן מתקפלת",
      schema: parsedQuerySchema,
      temperature: 0,
    });
  });

  it("retries once with a note when the first answer is unusable", async () => {
    const { llm, requests } = fakeLlm([raw({ product_terms: [] }), raw()]);
    const res = await parseQuery(llm, "מנורת שולחן");
    expect(res.parsed).not.toBeNull();
    expect(res.usage).toHaveLength(2);
    expect(requests[1].system.startsWith(PARSE_SYSTEM)).toBe(true);
    expect(requests[1].system.length).toBeGreaterThan(PARSE_SYSTEM.length);
    expect(requests[1].temperature).toBe(0);
  });

  it("reads גן in the query as a kindergarten", async () => {
    const { llm } = fakeLlm([
      raw({
        product_terms: ["water bottle", "garden bottle"],
        category_hint: "children water bottles",
      }),
    ]);
    const res = await parseQuery(llm, "בקבוק מים לגן שלא נוזל");
    expect(res.parsed?.product_terms).toEqual(["water bottle"]);
  });

  it("retries when the provider returns no data", async () => {
    const { llm } = fakeLlm([null, raw()]);
    expect((await parseQuery(llm, "מנורת שולחן")).parsed).not.toBeNull();
  });

  it("returns null after the last attempt and keeps the usage of every call", async () => {
    const { llm, requests } = fakeLlm([null, raw({ keywords_en: "" }), raw()]);
    const res = await parseQuery(llm, "מנורת שולחן");
    expect(res.parsed).toBeNull();
    expect(res.usage).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });

  it("honors maxAttempts", async () => {
    const { llm, requests } = fakeLlm([null, raw()]);
    const res = await parseQuery(llm, "מנורת שולחן", { maxAttempts: 1 });
    expect(res.parsed).toBeNull();
    expect(requests).toHaveLength(1);
    expect(res.model).toBe("fake-model-snapshot");
  });
});
