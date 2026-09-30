import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { EXPLAIN_SYSTEM, TITLE_RULE } from "./explain";
import type { LlmProvider, StructuredRequest } from "./provider";
import { titleProducts, TITLES_SYSTEM, TITLES_TOKENS, titlesSchema } from "./titles";

const USAGE = { inputTokens: 700, outputTokens: 180, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Answers with `titles` by short id and records the request. */
function fakeLlm(titles: Record<string, string> | null) {
  const requests: StructuredRequest<typeof titlesSchema>[] = [];
  const llm: LlmProvider = {
    name: "anthropic",
    model: "fake",
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
      requests.push(req as unknown as StructuredRequest<typeof titlesSchema>);
      const data = titles
        ? { items: Object.entries(titles).map(([id, title_he]) => ({ id, title_he })) }
        : null;
      return { data: data as z.infer<T> | null, usage: USAGE, model: "fake-model" };
    },
  };
  return { llm, requests };
}

const CONTEXT = { product_he: "בלונים ליום הולדת", requirements_he: ["סוניק"] };
const products = [
  { product_id: "1005001", title_en: "Sonic Number 3 Foil Balloon Birthday Party 32inch" },
  { product_id: "1005002", title_en: "Sonic Hedgehog Plush Balloon Set Expandable" },
  { product_id: "1005003", title_en: "Sonic Birthday Balloons Party Decoration" },
];

describe("TITLES_SYSTEM", () => {
  it("gives the model explain's own title rule, and no line to write", () => {
    expect(TITLES_SYSTEM).toContain(TITLE_RULE);
    expect(EXPLAIN_SYSTEM).toContain(TITLE_RULE);
    expect(TITLES_SYSTEM).not.toContain("why_he");
  });
});

describe("titleProducts", () => {
  it("asks once, at temperature 0, with the Hebrew labels and the English titles only", async () => {
    const { llm, requests } = fakeLlm({
      "1": "בלון מספר 3 של סוניק",
      "2": "סט בלונים של סוניק",
      "3": "בלוני יום הולדת של סוניק",
    });
    const res = await titleProducts(llm, CONTEXT, products);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.temperature).toBe(0);
    expect(req.system).toBe(TITLES_SYSTEM);
    expect(req.maxTokens).toBe(TITLES_TOKENS.base + TITLES_TOKENS.perProduct * products.length);
    // 5 titles fit well inside the cap (about 40 tokens each with their JSON).
    expect(TITLES_TOKENS.base + TITLES_TOKENS.perProduct * 5).toBeGreaterThanOrEqual(5 * 80);
    const sent = JSON.parse(req.user) as { search: unknown; products: unknown[] };
    expect(sent.search).toEqual(CONTEXT);
    expect(sent.products).toEqual(
      products.map((p, i) => ({ id: String(i + 1), title_en: p.title_en })),
    );
    expect(res.items.map((i) => i.title_he)).toEqual([
      "בלון מספר 3 של סוניק",
      "סט בלונים של סוניק",
      "בלוני יום הולדת של סוניק",
    ]);
    expect(res).toMatchObject({ usage: USAGE, model: "fake-model" });
  });

  it("repairs a title exactly as explain does, and rejects what cannot be repaired", async () => {
    const { llm } = fakeLlm({
      // A Latin word that is no brand, model or spec is dropped.
      "1": "בלון מספר 3 של סוניק Birthday",
      // An English word in Hebrew letters becomes Hebrew (fixTransliterations).
      "2": "סט בלונים פלוש של סוניק",
      // A number the English title does not have is never shown.
      "3": "5 בלוני יום הולדת של סוניק",
    });
    const res = await titleProducts(llm, CONTEXT, products);
    expect(res.items[0].title_he).toBe("בלון מספר 3 של סוניק");
    expect(res.items[1].title_he).not.toContain("פלוש");
    expect(res.items[2]).toMatchObject({
      title_he: null,
      rejected: { title_problem: "ungrounded_number" },
    });
  });

  it("gives a product the model skipped, or an unusable answer, no Hebrew title", async () => {
    const skipped = await titleProducts(
      fakeLlm({ "1": "בלון מספר 3 של סוניק" }).llm,
      CONTEXT,
      products,
    );
    expect(skipped.items.map((i) => i.title_he)).toEqual(["בלון מספר 3 של סוניק", null, null]);
    expect(skipped.items[1].rejected).toEqual({ title_problem: "missing" });
    const unusable = await titleProducts(fakeLlm(null).llm, CONTEXT, products);
    expect(unusable.items.every((i) => i.title_he === null)).toBe(true);
  });

  it("makes no call for no products", async () => {
    const { llm, requests } = fakeLlm({});
    expect((await titleProducts(llm, CONTEXT, [])).items).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
