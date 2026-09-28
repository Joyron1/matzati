import { describe, expect, it } from "vitest";
import type { ParsedQuery } from "@/lib/search/filters";
import {
  checkExplanation,
  EXPLAIN_SYSTEM,
  explainContextFrom,
  explainProducts,
  whyFromData,
  withoutRepeatedLines,
  WHY_TEMPLATE,
  type ExplainContext,
  type ExplainInput,
} from "./explain";
import type { LlmProvider, LlmUsage } from "./provider";

// Real products and Haiku 4.5 outputs from scripts/search-smoke.ts and
// fixtures/llm/eval-2026-09-27.json.
const input: ExplainInput = {
  product_id: "1005008500784169",
  title_en: "2024 Sports Neckband Wireless Running Universal Earphone Ear-hook Headphone Earplugs",
  price_ils: 18.43,
  original_price_ils: 38.4,
  discount_pct: 52,
  positive_feedback_pct: 98,
  units_sold_30d: 405,
};
const context: ExplainContext = {
  product_he: "אוזניות לריצה",
  requirements_he: ["עמידות למים"],
  max_price_ils: 100,
  sort_preference: "best_value",
};

const chargers: ExplainInput[] = [
  {
    product_id: "1005006995547868",
    title_en:
      "Essager 67W GaN USB Type C Charger For Laptop 45W 25W PD QC 3.0 Fast Charge For Macbook Xiaomi Samsung Iphone14 13 Phone Chagers",
    price_ils: 48.4,
    original_price_ils: 100.83,
    discount_pct: 52,
    positive_feedback_pct: 98.7,
    units_sold_30d: 1928,
  },
  {
    product_id: "1005012218235654",
    title_en:
      "100W GaN PD Type C Charger USB QC 3.0 For Laptop Ipad PPS Fast Charge EU UK For Samsung Xiaomi iPhone 15 16 Pro Max Mobile Phone",
    price_ils: 38.74,
    original_price_ils: 77.48,
    discount_pct: 50,
    positive_feedback_pct: 98,
    units_sold_30d: 3152,
  },
  {
    product_id: "1005012221738703",
    title_en:
      "Real 85W GaN Type C Charger USB QC3.0 For Laptop Ipad PPS PD 65W Fast Charge For Samsung Xiaomi iPhone 6-16 Pro Max Mobile Phone",
    price_ils: 27.31,
    original_price_ils: 54.61,
    discount_pct: 50,
    positive_feedback_pct: 98,
    units_sold_30d: 1484,
  },
];
const chargerContext: ExplainContext = {
  product_he: "מטען מהיר",
  requirements_he: ["65W"],
  sort_preference: "best_value",
};
const TITLE = "מטען GaN מהיר";

describe("checkExplanation", () => {
  it("keeps a grounded, plural line", () => {
    const why = "אוזניות צוואר אלחוטיות לריצה עם 98% משוב חיובי ו־405 נמכרו ב־30 הימים האחרונים.";
    const out = checkExplanation(
      { title_he: "אוזניות ספורט עם צוואר", why_he: why },
      input,
      [input],
      context,
    );
    expect(out).toEqual({
      title_problem: null,
      why_problem: null,
      title_he: "אוזניות ספורט עם צוואר",
      why_he: why,
    });
  });

  it("rejects the Arabic-letter title Haiku produced", () => {
    const why = "אוזניות ספורט אלחוטיות עם הנחה של 52% ו־98% משוב חיובי.";
    const out = checkExplanation(
      { title_he: "אוזניות ספורט אלחוטיות עם חיבור לרقبה", why_he: why },
      input,
      [input],
      context,
    );
    expect(out.title_he).toBeNull();
    expect(out.why_he).toBe(why);
    expect(out.title_problem).toBe("foreign_script");
  });

  it("rejects the singular-address line Haiku produced", () => {
    const out = checkExplanation(
      { title_he: "אוזניות ספורט", why_he: "במחיר של ₪18.43 המתאים לתקציב שלך." },
      input,
      [input],
      context,
    );
    expect(out.why_he).toBeNull();
    expect(out.why_problem).toBe("singular_address");
  });

  it("rejects numbers that are not in the data", () => {
    const out = checkExplanation(
      { title_he: "אוזניות ספורט 2025", why_he: "98% משוב חיובי ויותר מ־400 מכירות." },
      input,
      [input],
      context,
    );
    expect(out.title_he).toBeNull(); // 2025 is not in the original title
    expect(out.why_he).toBeNull(); // 400 is not in the data (405 is)
    expect(out.why_problem).toBe("ungrounded_number");
  });

  it("rejects request details the model never saw and numbers from another product", () => {
    const age = checkExplanation(
      { title_he: TITLE, why_he: "מתאים לילדים בני 3, עם 98% משוב חיובי מהקונים." },
      input,
      [input],
      context,
    );
    expect(age.why_problem).toBe("ungrounded_number");
    const other = checkExplanation(
      { title_he: TITLE, why_he: "מטען 67W לטלפון ולמחשב נייד, 3152 נמכרו ב־30 הימים האחרונים." },
      chargers[0],
      chargers,
      chargerContext,
    );
    expect(other.why_problem).toBe("ungrounded_number");
  });

  it("rejects a truncated line and drops the title cut by the same quote", () => {
    const cutlery: ExplainInput = {
      product_id: "1005013004164872",
      title_en:
        "UpgradedAdjustable Plastic Cutlery Drawer Organizer Divided Storage Tray Space Saving Holder for Kitchen Knives Spoons Tableware",
      price_ils: 16.91,
      original_price_ils: 35.22,
      discount_pct: 52,
      positive_feedback_pct: 100,
      units_sold_30d: 331,
    };
    const out = checkExplanation(
      { title_he: "מארגן סכו", why_he: "מארגן פלסטיק לסכו" },
      cutlery,
      [cutlery],
      context,
    );
    expect(out).toEqual({
      title_he: null,
      why_he: null,
      title_problem: "truncated",
      why_problem: "truncated",
    });
  });

  it("rejects Latin letters inside a Hebrew word (the 'רשult' Haiku produced)", () => {
    const pad: ExplainInput = {
      product_id: "1005008077631444",
      title_en:
        "Car Wireless Charging Pad For New Tesla Model 3/Y 2024 2023 2022 Center Console Charger Mat Phone Mount Silicone Non-slip Pads",
      price_ils: 9.69,
      original_price_ils: 20.18,
      discount_pct: 52,
      positive_feedback_pct: 98,
      units_sold_30d: 973,
    };
    const out = checkExplanation(
      {
        title_he: "משטח סיליקון לטסלה 3/Y",
        why_he: "מטען אלחוטי מיוחד לטסלה 2022-2024 עם רשult לא החלקה בקונסולה המרכזית.",
      },
      pad,
      [pad],
      context,
    );
    expect(out.why_he).toBeNull();
    expect(out.why_problem).toBe("mixed_script");
    expect(out.title_he).toBe("משטח סיליקון לטסלה 3/Y");
  });

  it("adds the missing maqaf after a one-letter prefix instead of rejecting", () => {
    const out = checkExplanation(
      {
        title_he: "מטען GaN 85W",
        why_he: "מטען GaN בעוצמת 85W עם PD 65W וQC3.0 לטלפון ולמחשב נייד.",
      },
      chargers[2],
      chargers,
      chargerContext,
    );
    expect(out.why_problem).toBeNull();
    expect(out.why_he).toBe("מטען GaN בעוצמת 85W עם PD 65W ו־QC3.0 לטלפון ולמחשב נייד.");
  });

  it("rejects a written price, which would disagree with the rounded card price", () => {
    const out = checkExplanation(
      { title_he: TITLE, why_he: "מטען מהיר לטלפון ולמחשב נייד במחיר 27.31 ש״ח." },
      chargers[2],
      chargers,
      chargerContext,
    );
    expect(out.why_problem).toBe("price_written");
    const bare = checkExplanation(
      { title_he: TITLE, why_he: "מטען מהיר לטלפון ולמחשב נייד שעולה רק 27.31." },
      chargers[2],
      chargers,
      chargerContext,
    );
    expect(bare.why_problem).toBe("ungrounded_number");
  });

  describe("superlatives are checked against the products shown together", () => {
    const check = (why: string, p: ExplainInput, batch = chargers) =>
      checkExplanation({ title_he: TITLE, why_he: why }, p, batch, chargerContext).why_problem;
    const cheapest = "מטען GaN מהיר לטלפון ולמחשב נייד, הזול מבין השלושה.";
    const mostSold = "מטען GaN מהיר לטלפון ולמחשב נייד, הנמכר ביותר מבין השלושה.";

    it("keeps true claims", () => {
      expect(check(cheapest, chargers[2])).toBeNull();
      expect(check(mostSold, chargers[1])).toBeNull();
      expect(check("מטען GaN עם המשוב החיובי הגבוה ביותר מבין השלושה.", chargers[0])).toBeNull();
    });

    it("rejects false claims", () => {
      expect(check(cheapest, chargers[0])).toBe("false_superlative");
      expect(check(mostSold, chargers[2])).toBe("false_superlative");
      expect(check("מחיר הכי נמוך בקבוצה, מטען מהיר לטלפון.", chargers[1])).toBe(
        "false_superlative",
      );
    });

    it("rejects claims nothing can prove, and any comparison with a single product", () => {
      expect(check("המטען הכי טוב לטלפון ולמחשב נייד.", chargers[2])).toBe("false_superlative");
      expect(check("מטען GaN מהיר לטלפון, המשתלם מבין השלושה.", chargers[2])).toBe(
        "false_superlative",
      );
      expect(check(cheapest, chargers[2], [chargers[2]])).toBe("false_superlative");
    });

    it("rejects a comparison over a different number of products than were shown", () => {
      const ofTwo = "מטען GaN מהיר לטלפון ולמחשב נייד, הזול מבין השניים.";
      expect(check(ofTwo, chargers[2])).toBe("false_superlative");
      expect(check(cheapest, chargers[2], chargers.slice(1))).toBe("false_superlative");
      expect(check(ofTwo, chargers[2], chargers.slice(1))).toBeNull();
    });
  });
});

describe("'הכותרת לא מציינת' caveats name only a requirement from the search", () => {
  // Recorded round-2 lines (fixtures/llm/eval-v2-2026-09-27.json).
  const vent: ExplainInput = {
    product_id: "1005011822823662",
    title_en:
      "Car For Magsafe Wireless Charger Pad Air Vent Phone Holder Stand For iPhone 17~12 Samsung Xiaomi Fast Charging Cellphone Bracket",
    price_ils: 15.43,
    original_price_ils: 30.87,
    discount_pct: 50,
    positive_feedback_pct: 98,
    units_sold_30d: 2726,
  };
  const wall: ExplainInput = {
    product_id: "1005010376516082",
    title_en:
      "65W USB-C Wall Charger with Retractable Cable Super Fast Charging QC 3.0 USB PD for iPhone 17/16 POCO Xiaomi - Phone Chargers",
    price_ils: 15.59,
    original_price_ils: 32.47,
    discount_pct: 52,
    positive_feedback_pct: 98,
    units_sold_30d: 11698,
  };
  const holderContext: ExplainContext = {
    product_he: "מחזיק טלפון לרכב",
    requirements_he: ["טעינה אלחוטית"],
    sort_preference: "best_value",
  };
  const check = (why: string, p: ExplainInput, ctx: ExplainContext) =>
    checkExplanation({ title_he: TITLE, why_he: why }, p, [p], ctx);

  it("drops a trailing caveat about a feature nobody asked for", () => {
    const out = check(
      "מחזיק טעינה אלחוטית מהירה ל־iPhone וטלפונים נוספים, 98% משוב חיובי, אבל הכותרת לא מציינת ידית הרכבה.",
      vent,
      holderContext,
    );
    expect(out.why_problem).toBeNull();
    expect(out.why_he).toBe("מחזיק טעינה אלחוטית מהירה ל־iPhone וטלפונים נוספים, 98% משוב חיובי.");
    const garbled = check(
      "מטען 65W עם טעינה מהירה וכבל נשלף, 98% משוב חיובי, אבל הכותרת לא מציינת שיחוק קוויק.",
      wall,
      {
        product_he: "מטען מהיר 65W",
        requirements_he: ["65W", "טעינה מהירה"],
        sort_preference: "best_value",
      },
    );
    expect(garbled.why_he).toBe("מטען 65W עם טעינה מהירה וכבל נשלף, 98% משוב חיובי.");
  });

  it("drops a caveat when the search stated no requirements at all", () => {
    const pad: ExplainInput = {
      product_id: "1005010439353509",
      title_en: "10PCS Padlock Shim Picks Set Accessories Set Tools Home Garden Tools",
      price_ils: 7,
      original_price_ils: 14,
      discount_pct: 50,
      positive_feedback_pct: 98,
      units_sold_30d: 577,
    };
    const out = check(
      "אביזר משלים, לא כלי גינה: סט 10 שימים לנעילות לשימוש בבית וגינה, אבל הכותרת לא מציינת שימוש בגינון.",
      pad,
      { product_he: "כלים לגינון", requirements_he: [], sort_preference: "best_value" },
    );
    expect(out.why_he).toBe("אביזר משלים, לא כלי גינה: סט 10 שימים לנעילות לשימוש בבית וגינה.");
  });

  it("keeps a caveat about a stated requirement, in any prefix form", () => {
    for (const why of [
      "אוזניות צוואר אלחוטיות לריצה, אבל הכותרת לא מציינת עמידות למים.",
      "אוזניות צוואר אלחוטיות לריצה, אך הכותרת לא מציינת עמידות במים.",
    ]) {
      const out = check(why, input, context);
      expect([why, out.why_problem]).toEqual([why, null]);
      expect(out.why_he).toBe(why);
    }
    const latin = check(
      "מטען GaN מהיר לטלפון ולמחשב נייד, אבל הכותרת לא מציינת USB-C.",
      chargers[1],
      {
        ...chargerContext,
        requirements_he: ["USB-C"],
      },
    );
    expect(latin.why_problem).toBeNull();
  });

  it("rejects an unrequested caveat it cannot cut off cleanly", () => {
    const out = check(
      "הכותרת לא מציינת התאמה לכל הטלפונים, אבל זהו מחזיק עם טעינה אלחוטית מהירה.",
      vent,
      holderContext,
    );
    expect(out.why_he).toBeNull();
    expect(out.why_problem).toBe("unrequested_caveat");
    // Two caveats: cutting the last one would keep the unrequested first one.
    const two = check(
      "מחזיק לרכב, הכותרת לא מציינת ידית הרכבה, אבל הכותרת לא מציינת טעינה אלחוטית.",
      vent,
      holderContext,
    );
    expect(two.why_problem).toBe("unrequested_caveat");
  });

  it("falls back when nothing but the caveat was written", () => {
    const out = check("הכותרת לא מציינת ידית הרכבה למחזיק ברכב.", vent, holderContext);
    expect(out.why_he).toBeNull();
  });

  it("tells the model to write caveats only about requirements_he", () => {
    expect(EXPLAIN_SYSTEM).toMatch(/הכותרת לא מציינת[^\n]*requirements_he/);
  });
});

describe("Hebrew checks (docs/search-quality-plan.md A9)", () => {
  // Recorded round-3 cards (fixtures/llm/eval-v3-2026-09-27.json).
  const drawer: ExplainInput = {
    product_id: "1005007170336837",
    title_en:
      "Expandable Kitchen Cabinet Drawer Organizer Rack, Multi‑Purpose Storage Shelf for Pots, Pans, Pot Lids, Cutting Boards Cookware",
    price_ils: 44.07,
    original_price_ils: 91.81,
    discount_pct: 52,
    positive_feedback_pct: 98,
    units_sold_30d: 3098,
  };
  const watch: ExplainInput = {
    product_id: "1005009384181339",
    title_en:
      "New For OPPO Ultra Thin Smart Watch Men AMOLED HD Screen Always Show Time Heart Rate Bluetooth Call Sports Waterproof Smartwatch",
    price_ils: 11.3,
    original_price_ils: 23.54,
    discount_pct: 52,
    positive_feedback_pct: 98,
    units_sold_30d: 2486,
  };
  const bottle: ExplainInput = {
    product_id: "1005008641098398",
    title_en:
      "Cute Kids Water Bottle with Straw Free BPA Leakproof Outdoor Portable Children's Cups School Water Bottle for Children",
    price_ils: 15.04,
    original_price_ils: 31.33,
    discount_pct: 52,
    positive_feedback_pct: 98,
    units_sold_30d: 304,
  };
  const noBudget: ExplainContext = {
    product_he: "בקבוק מים לגן",
    requirements_he: ["אטום לדליפות"],
    sort_preference: "best_value",
  };
  const why =
    "מארגן לאחסון סירים, מחבתות וקרשי חיתוך, 98% משוב חיובי ו־3098 נמכרו ב־30 הימים האחרונים.";
  const check = (item: { title_he: string; why_he: string }, p: ExplainInput, ctx = context) =>
    checkExplanation(item, p, [p], ctx);

  it("drops a Latin word from the title instead of showing the English title", () => {
    const out = check({ title_he: "מארגן מגירות מטבח Expandable למחבתות", why_he: why }, drawer);
    expect(out.title_he).toBe("מארגן מגירות מטבח למחבתות");
    expect(out.title_problem).toBeNull();
    const brand = check({ title_he: "שעון חכם OPPO עם מד דופק", why_he: why }, watch);
    expect(brand.title_he).toBe("שעון חכם עם מד דופק");
  });

  it("rejects a title with no Hebrew left, or with a garbled word", () => {
    expect(
      check({ title_he: "Expandable Kitchen Drawer Organizer", why_he: why }, drawer),
    ).toMatchObject({ title_he: null, title_problem: "foreign_word" });
    expect(check({ title_he: "מארגן עצם הסיסמום", why_he: why }, drawer)).toMatchObject({
      title_he: null,
      title_problem: "garbled_word",
    });
  });

  it("rejects a line with a brand the product only fits, or a garbled word", () => {
    const line = "שעון חכם OPPO עם מד דופק, 98% משוב חיובי ו־2486 נמכרו ב־30 הימים האחרונים.";
    expect(check({ title_he: "שעון חכם", why_he: line }, watch).why_problem).toBe("foreign_word");
    const garbled =
      "מארגן לצנצנות תבלינים וזקנין עם 98% משוב חיובי ו־3098 נמכרו ב־30 הימים האחרונים.";
    expect(check({ title_he: "מארגן", why_he: garbled }, drawer).why_problem).toBe("garbled_word");
  });

  it("allows the budget word only when the search gave a budget", () => {
    const line = "בקבוק אטום לדליפות, 98% משוב חיובי ומתחת לתקציב שלכם.";
    expect(check({ title_he: "בקבוק מים", why_he: line }, bottle, noBudget).why_problem).toBe(
      "unstated_budget",
    );
    expect(check({ title_he: "בקבוק מים", why_he: line }, bottle, context).why_problem).toBeNull();
  });

  it("fixes a shopper's typo in the lines", () => {
    const out = check(
      {
        title_he: "אוזניות ספורט עמידות למיים",
        why_he: "אוזניות צוואר אלחוטיות לריצה עמידות למיים, 98% משוב חיובי.",
      },
      input,
    );
    expect(out.title_he).toBe("אוזניות ספורט עמידות למים");
    expect(out.why_he).toBe("אוזניות צוואר אלחוטיות לריצה עמידות למים, 98% משוב חיובי.");
  });
});

describe("withoutRepeatedLines", () => {
  const holders: ExplainInput[] = [5089, 2941, 3156].map((sold, i) => ({
    product_id: `h${i}`,
    title_en: "Magnetic Car Wireless Charger Mount 15W Fast Charging For iPhone",
    price_ils: 13.89 + i,
    original_price_ils: null,
    discount_pct: null,
    positive_feedback_pct: 98,
    units_sold_30d: sold,
  }));
  const line = (sold: number) =>
    `מחזיק טלפון עם טעינה אלחוטית, 98% משוב חיובי ו־${sold} נמכרו ב־30 הימים האחרונים.`;
  const fromModel = (p: ExplainInput, why: string) => ({
    product_id: p.product_id,
    title_he: "מחזיק טלפון לרכב",
    why_he: why,
    why_from_model: true,
  });

  it("keeps the first of the same line and builds the others from data (eval round 3)", () => {
    const out = withoutRepeatedLines(
      holders.map((p) => fromModel(p, line(p.units_sold_30d!))),
      holders,
    );
    expect(out[0].why_he).toBe(line(5089));
    expect(out[1]).toMatchObject({
      why_he: "98% משוב חיובי ו־2,941 נמכרו ב־30 הימים האחרונים.",
      why_from_model: false,
      rejected: { why_he: line(2941), why_problem: "repeated_line" },
    });
    expect(out[2].rejected?.why_problem).toBe("repeated_line");
  });

  it("tells lines apart by a spec number, and leaves lines built from data alone", () => {
    const spec = (mah: number) => `סוללת גיבוי בנפח ${mah} מיליאמפר, 98% משוב חיובי.`;
    const out = withoutRepeatedLines(
      [
        fromModel(holders[0], spec(10000)),
        fromModel(holders[1], spec(20000)),
        { ...fromModel(holders[2], "98% משוב חיובי."), why_from_model: false },
      ],
      holders,
    );
    expect(out.map((i) => i.why_from_model)).toEqual([true, true, false]);
  });

  it("runs on every batch explainProducts returns", async () => {
    const llm: LlmProvider = {
      name: "anthropic",
      model: "fake-model",
      async generateStructured(req) {
        const items = holders.map((p, i) => ({
          id: String(i + 1),
          title_he: "מחזיק טלפון לרכב",
          why_he: line(p.units_sold_30d!),
        }));
        return {
          data: req.schema.parse({ items }),
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          model: "fake-1",
        };
      },
    };
    const res = await explainProducts(llm, context, holders);
    expect(res.items.map((i) => i.why_from_model)).toEqual([true, false, false]);
  });
});

describe("whyFromData", () => {
  it("builds a true sentence from the trust data", () => {
    expect(whyFromData(chargers[0])).toBe("98.7% משוב חיובי ו־1,928 נמכרו ב־30 הימים האחרונים.");
  });

  it("skips a missing metric", () => {
    expect(whyFromData({ ...chargers[1], units_sold_30d: null })).toBe("98% משוב חיובי.");
    expect(whyFromData({ ...chargers[1], positive_feedback_pct: null })).toBe(
      "3,152 נמכרו ב־30 הימים האחרונים.",
    );
    expect(whyFromData({ ...chargers[1], positive_feedback_pct: null, units_sold_30d: null })).toBe(
      WHY_TEMPLATE,
    );
  });

  it("passes our own checks", () => {
    for (const p of chargers) {
      const out = checkExplanation(
        { title_he: TITLE, why_he: whyFromData(p) },
        p,
        chargers,
        chargerContext,
      );
      expect(out.why_problem).toBeNull();
    }
  });
});

describe("explainContextFrom", () => {
  it("keeps only the filters and labels, never the raw query", () => {
    const parsed: ParsedQuery = {
      keywords_en: "running earphones waterproof",
      product_terms: ["earphones", "headphones"],
      requirements: [{ en: "waterproof", alt: ["water resistant"], he: "עמידות למים" }],
      max_price_ils: 99.6,
      sort_preference: "cheapest",
      product_he: "אוזניות לריצה",
      category_hint: "sports earphones",
    };
    expect(explainContextFrom(parsed)).toEqual({
      product_he: "אוזניות לריצה",
      requirements_he: ["עמידות למים"],
      max_price_ils: 100,
      sort_preference: "cheapest",
    });
  });

  it("spells the labels right even in a parse saved with a typo", () => {
    const parsed: ParsedQuery = {
      keywords_en: "waterproof bluetooth running headphones",
      product_terms: ["running headphones"],
      requirements: [{ en: "waterproof", alt: [], he: "עמידות למיים" }],
      sort_preference: "best_value",
      product_he: "אוזניות בלוטות לריצה",
    };
    expect(explainContextFrom(parsed)).toMatchObject({
      product_he: "אוזניות בלוטוס לריצה",
      requirements_he: ["עמידות למים"],
    });
  });
});

describe("explainProducts", () => {
  const USAGE: LlmUsage = {
    inputTokens: 900,
    outputTokens: 270,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  function fakeLlm(data: unknown) {
    const requests: { system: string; user: string }[] = [];
    const llm: LlmProvider = {
      name: "anthropic",
      model: "fake-model",
      async generateStructured(req) {
        requests.push({ system: req.system, user: req.user });
        return {
          data: data === null ? null : req.schema.parse(data),
          usage: USAGE,
          model: "fake-1",
        };
      },
    };
    return { llm, requests };
  }

  const WHY_1 = "מטען GaN מהיר לטלפון ולמחשב נייד עם תמיכה ב־PD.";
  const WHY_2 = "מטען GaN חזק לטלפון, לטאבלט ולמחשב נייד.";

  it("sends short ids and the filters only, then maps the answers back", async () => {
    const { llm, requests } = fakeLlm({
      items: [
        { id: "2", title_he: "מטען GaN 100W", why_he: WHY_2 },
        { id: " 1 ", title_he: "מטען Essager 67W", why_he: WHY_1 },
        { id: "1", title_he: "כפול", why_he: "תשובה כפולה שלא אמורה להיבחר בכלל." },
      ],
    });
    const res = await explainProducts(llm, chargerContext, chargers);

    expect(requests).toHaveLength(1);
    expect(requests[0].system).toBe(EXPLAIN_SYSTEM);
    const sent = JSON.parse(requests[0].user);
    expect(sent.search).toEqual(chargerContext);
    expect(sent.products.map((p: { id: string }) => p.id)).toEqual(["1", "2", "3"]);
    expect(requests[0].user).not.toContain("product_id");
    expect(requests[0].user).not.toContain(chargers[0].product_id);

    expect(res.model).toBe("fake-1");
    expect(res.usage).toEqual(USAGE);
    expect(res.items.map((i) => i.product_id)).toEqual(chargers.map((c) => c.product_id));
    expect(res.items[0]).toEqual({
      product_id: chargers[0].product_id,
      title_he: "מטען Essager 67W",
      why_he: WHY_1,
      why_from_model: true,
    });
    expect(res.items[1].title_he).toBe("מטען GaN 100W");
    // The model skipped id "3": the line is built from data.
    expect(res.items[2]).toEqual({
      product_id: chargers[2].product_id,
      title_he: null,
      why_he: "98% משוב חיובי ו־1,484 נמכרו ב־30 הימים האחרונים.",
      why_from_model: false,
      rejected: { title_problem: "missing", why_problem: "missing" },
    });
  });

  it("records what a check rejected and falls back to data", async () => {
    const { llm } = fakeLlm({
      items: [
        { id: "1", title_he: "מטען Essager 67W", why_he: "הזול מבין השלושה, מטען מהיר לטלפון." },
      ],
    });
    const [first] = (await explainProducts(llm, chargerContext, chargers)).items;
    expect(first).toEqual({
      product_id: chargers[0].product_id,
      title_he: "מטען Essager 67W",
      why_he: "98.7% משוב חיובי ו־1,928 נמכרו ב־30 הימים האחרונים.",
      why_from_model: false,
      rejected: { why_he: "הזול מבין השלושה, מטען מהיר לטלפון.", why_problem: "false_superlative" },
    });
  });

  it("falls back for every product when the output did not match the schema", async () => {
    const { llm } = fakeLlm(null);
    const res = await explainProducts(llm, chargerContext, chargers);
    expect(res.items.every((i) => !i.why_from_model && i.rejected?.why_problem === "missing")).toBe(
      true,
    );
  });

  it("does not call the model without products", async () => {
    const { llm, requests } = fakeLlm({ items: [] });
    const res = await explainProducts(llm, chargerContext, []);
    expect(res.items).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
