// The explain step and shared numbers (lib/ranking/shared-numbers.ts): a number other listings of
// one shop show too is never stated as a product's own, and no line compares trust numbers in a
// batch that holds a listing of such a shop.
import { describe, expect, it } from "vitest";
import {
  checkExplanation,
  explainProducts,
  WHY_TEMPLATE,
  whyFromData,
  type ExplainContext,
  type ExplainInput,
} from "./explain";
import type { LlmProvider } from "./provider";

// Real listings from the drawer-organizer snapshots (fixtures/snapshots/live-drawer-organizer.json,
// home-drawer.json). The first is one of the shop's two listings at exactly 11,268 sales, at the
// 98% most of the shop's listings show.
const shared: ExplainInput = {
  product_id: "1005006995257180",
  title_en:
    "Thicken Clothes Organizer Pants Sweater Storage Cabinets Drawers Organizer Jeans Storage Box Wardrobe Clothes Storage Organizers",
  price_ils: 11.23,
  original_price_ils: 23.4,
  discount_pct: 52,
  positive_feedback_pct: 98,
  units_sold_30d: 11_268,
  shared_numbers: { feedback: true, sales: true },
};
/** Another listing of that shop (made up): sales of its own, the shop's 98%. */
const ownSales: ExplainInput = {
  ...shared,
  product_id: "1005000000003050",
  units_sold_30d: 3_050,
  shared_numbers: { feedback: true, sales: false },
};
/** A listing of that shop whose two numbers are its own (98.3%, 4,744 in the ex-8 pool). */
const ownNumbers: ExplainInput = {
  ...shared,
  product_id: "1005013266358009",
  positive_feedback_pct: 98.3,
  units_sold_30d: 4_744,
  shared_numbers: { feedback: false, sales: false },
};
const topRated: ExplainInput = {
  product_id: "1005013004164872",
  title_en:
    "UpgradedAdjustable Plastic Cutlery Drawer Organizer Divided Storage Tray Space Saving Holder for Kitchen Knives Spoons Tableware",
  price_ils: 16.93,
  original_price_ils: 35.26,
  discount_pct: 52,
  positive_feedback_pct: 100,
  units_sold_30d: 344,
};
const third: ExplainInput = {
  product_id: "1005010621821117",
  title_en:
    "1Pc Expandable Kitchen Drawer Organizer - Adjustable Retractable Cutlery Storage Box with Dividers for Utensils,Drawer Organizer",
  price_ils: 16.65,
  original_price_ils: 36.21,
  discount_pct: 54,
  positive_feedback_pct: 95.7,
  units_sold_30d: 1_100,
};
const batch = [shared, topRated, third];
/** The same listing as if its shop did not share numbers. */
const unmarked: ExplainInput = { ...shared, shared_numbers: undefined };
const context: ExplainContext = {
  product_he: "מארגן מגירות",
  requirements_he: [],
  sort_preference: "best_value",
};
const TITLE = "מארגן מגירות";

const why = (line: string, p: ExplainInput, b = batch) =>
  checkExplanation({ title_he: TITLE, why_he: line }, p, b, context).why_problem;

describe("shared numbers in the explain step", () => {
  it("never sends the model a shared number", async () => {
    const users: string[] = [];
    const llm: LlmProvider = {
      name: "anthropic",
      model: "fake-model",
      async generateStructured(req) {
        users.push(req.user);
        return {
          data: req.schema.parse({ items: [] }),
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          model: "fake-1",
        };
      },
    };
    const res = await explainProducts(llm, context, [shared, ownSales, ownNumbers]);
    const sent = JSON.parse(users[0]).products as Record<string, unknown>[];
    expect(sent.map((p) => [p.positive_feedback_pct, p.units_sold_30d])).toEqual([
      [null, null],
      [null, 3_050],
      [98.3, 4_744],
    ]);
    expect(users[0]).not.toContain("11268");
    // The mark itself stays ours: the model only sees that the number is missing.
    for (const p of sent) expect(p).not.toHaveProperty("shared_numbers");
    // No answer, so lines from the data: only the numbers that are each product's own.
    expect(res.items.map((i) => i.why_he)).toEqual([
      WHY_TEMPLATE,
      "3,050 נמכרו ב־30 הימים האחרונים.",
      "98.3% משוב חיובי ו־4,744 נמכרו ב־30 הימים האחרונים.",
    ]);
  });

  it("builds the data line without the shared numbers", () => {
    expect(whyFromData(shared)).toBe(WHY_TEMPLATE);
    expect(whyFromData({ ...shared, shared_numbers: { feedback: false, sales: true } })).toBe(
      "98% משוב חיובי.",
    );
    expect(whyFromData(ownSales)).toBe("3,050 נמכרו ב־30 הימים האחרונים.");
    expect(whyFromData(unmarked)).toBe("98% משוב חיובי ו־11,268 נמכרו ב־30 הימים האחרונים.");
  });

  it("rejects a line that states a shared number as the product's", () => {
    const sales = "מארגן בגדים עבה לארון, 11,268 נמכרו ב־30 הימים האחרונים.";
    const feedback = "מארגן בגדים עבה לארון ולמגירות, עם 98% משוב חיובי.";
    expect(why(sales, shared)).toBe("ungrounded_number");
    expect(why(feedback, shared)).toBe("ungrounded_number");
    expect(why(feedback, ownSales)).toBe("ungrounded_number");
    expect(why(sales, unmarked)).toBeNull();
    expect(why(feedback, unmarked)).toBeNull();
    // Numbers that are the listing's own may be quoted, also when its shop repeats others.
    expect(why("מארגן בגדים עבה לארון, 3,050 נמכרו ב־30 הימים האחרונים.", ownSales)).toBeNull();
    expect(why("מארגן בגדים עבה לארון ולמגירות, עם 98.3% משוב חיובי.", ownNumbers)).toBeNull();
  });

  it("allows no best-selling or best-rated claim in a batch with a listing of such a shop", () => {
    const mostSold = "מארגן בגדים עבה לארון, הנמכר ביותר מבין השלושה.";
    const bestRated = "מארגן סכו״ם מתכוונן, עם המשוב החיובי הגבוה ביותר מבין השלושה.";
    // Not for the shared listing, although its 11,268 is the most of the three...
    expect(why(mostSold, shared)).toBe("false_superlative");
    expect(why(mostSold, unmarked, [unmarked, topRated, third])).toBeNull();
    // ...and not for another product compared with it, although 100% is the most of the three...
    expect(why(bestRated, topRated)).toBe("false_superlative");
    expect(why(bestRated, topRated, [unmarked, topRated, third])).toBeNull();
    // ...nor next to a listing of that shop whose own numbers are not repeated.
    expect(why(bestRated, topRated, [ownNumbers, topRated, third])).toBe("false_superlative");
    // Without the shop's listing the comparison stands.
    expect(why(bestRated.replace("השלושה", "השניים"), topRated, [topRated, third])).toBeNull();
  });

  it("still allows a price comparison: each listing has its own price", () => {
    expect(why("מארגן בגדים עבה לארון ולמגירות, הזול מבין השלושה.", shared)).toBeNull();
  });
});
