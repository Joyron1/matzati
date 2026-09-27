import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  normalizeParsed,
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
