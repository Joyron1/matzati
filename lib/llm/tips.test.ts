import { describe, expect, it } from "vitest";
import type { LlmProvider, LlmUsage } from "./provider";
import {
  checkTips,
  generateCategoryTips,
  hasBrandLikeWord,
  hasStandaloneNumber,
  makesUnverifiableClaim,
  MAX_TIPS,
  TIP_MAX,
  tipProblem,
  TIPS_SYSTEM,
} from "./tips";

const USAGE: LlmUsage = {
  inputTokens: 700,
  outputTokens: 260,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function fakeLlm(data: unknown) {
  const requests: { system: string; user: string; temperature?: number }[] = [];
  const llm: LlmProvider = {
    name: "anthropic",
    model: "fake-model",
    async generateStructured(req) {
      requests.push({ system: req.system, user: req.user, temperature: req.temperature });
      return { data: data === null ? null : req.schema.parse(data), usage: USAGE, model: "fake-1" };
    },
  };
  return { llm, requests };
}

const GOOD = [
  "בדקו שהאוזניות עמידות למים לפי תקן מוגדר כמו IPX7, אם אתם מתכוונים להתאמן איתן בגשם.",
  "ודאו שהחיבור לטעינה הוא USB-C, כדי שתוכלו להשתמש באותו כבל של הטלפון.",
  "חפשו תמיכה ב־Bluetooth 5.0 ומעלה לחיבור יציב יותר לטלפון.",
];

describe("hasStandaloneNumber", () => {
  it("allows digits inside Latin spec tokens", () => {
    for (const text of [
      "חפשו עמידות IPX7 או IP67.",
      "מטען של 65W לפחות למחשב נייד.",
      "חיבור USB-C ותמיכה ב־Bluetooth 5.3.",
      "תדר 2.4GHz ומתח 5V/2A.",
      "שקע 3.5mm ורזולוציה 4K.",
      "תמיכה ב־Wi-Fi 6 או USB 3.0, ולא פחות.",
    ]) {
      expect(hasStandaloneNumber(text), text).toBe(false);
    }
  });

  it("rejects numbers that stand alone", () => {
    for (const text of [
      "בדקו שיש אחריות של 3 שנים.",
      "90% מהקונים מרוצים.",
      "המשלוח לוקח בין 1-2 שבועות.",
      "החזירו תוך ל־30 יום.",
      "מתאים לגילאי 18+ בלבד.",
      "חיבור USB 100% תקין.",
      "סוללה של 5000 מיליאמפר.",
      "שרשרת עם LED 100 נורות.", // a count after a Latin word is not a version
    ]) {
      expect(hasStandaloneNumber(text), text).toBe(true);
    }
  });
});

describe("makesUnverifiableClaim", () => {
  it("flags superlatives and statistics about buyers written in words", () => {
    for (const text of [
      "בדקו איזה חומר הוא הכי טוב לשימוש יומיומי.",
      "חפשו את הדגם החזק ביותר שמתאים לכם.",
      "רוב הקונים מעדיפים כבלים קלועים.",
      "כדאי לדעת שרוב המשתמשים מחליפים את הרצועה.",
      "לקוחות רבים ממליצים לבדוק את המידות.",
      "חלק מהקונים מתלוננים על ריח של פלסטיק.",
    ]) {
      expect(makesUnverifiableClaim(text), text).toBe(true);
    }
  });

  it("allows plain advice", () => {
    for (const text of [
      ...GOOD,
      "קראו מה כלול באריזה, כי חלק מהאביזרים נמכרים בנפרד.",
      "השוו את החומר: סיליקון רך נוח לאחיזה ומגן יותר על המכשיר.",
    ]) {
      expect(makesUnverifiableClaim(text), text).toBe(false);
    }
  });
});

describe("hasBrandLikeWord", () => {
  it("allows acronyms, spec tokens and known standard words", () => {
    expect(hasBrandLikeWord("חיבור USB-C, HDMI ו־Type-C עם Bluetooth ו־Wi-Fi.")).toBe(false);
    expect(hasBrandLikeWord("סוללה של 5000mAh ומטען GaN עם Qi2.")).toBe(false);
  });

  it("flags other Latin words, which are usually brands or product names", () => {
    expect(hasBrandLikeWord("כבלים של Anker מחזיקים יותר.")).toBe(true);
    expect(hasBrandLikeWord("ודאו שהראש מתאים ל־Oral-B.")).toBe(true);
    expect(hasBrandLikeWord("בדקו התאמה ל־iPhone.")).toBe(true);
  });
});

describe("tipProblem and checkTips", () => {
  it("keeps practical, plural, generic tips", () => {
    for (const tip of GOOD) expect(tipProblem(tip), tip).toBeNull();
  });

  it("drops every tip that fails a check and keeps the rest in order", () => {
    const raw = [
      GOOD[0],
      "בדוק שהמוצר מתאים לטלפון שלך.", // singular address
      "אל תשלמו יותר מ־₪50 על זוג אוזניות.", // price
      "חפשו אחריות של שנתיים לפחות, או 2 שנים.", // standalone number
      "רוב הקונים מעדיפים דגמים עם 95% משוב חיובי.", // statistic
      "בחרו תמיד בדגם הכי טוב שאפשר למצוא.", // superlative
      "כבלים של Anker מחזיקים יותר זמן.", // brand
      "בדקו את מידת הרקبה לפני ההזמנה.", // Arabic letters
      "בדקו שהמוצר עובד היטבly בכל מזג אוויר.", // mixed script
      GOOD[1],
      `בדקו ${"את המפרט ".repeat(20)}.`, // too long
      "בדקו את המידות", // no final period: cut off
      ` ${GOOD[0]} `, // repeat
      GOOD[2],
    ];
    const { tips, rejected } = checkTips(raw);
    expect(tips).toEqual(GOOD);
    expect(rejected.map((r) => r.problem)).toEqual([
      "singular_address",
      "price_written",
      "number",
      "number",
      "claim",
      "latin_word",
      "foreign_script",
      "mixed_script",
      "too_long",
      "truncated",
      "duplicate",
    ]);
  });

  it("tidies Hebrew marks before checking", () => {
    const { tips } = checkTips(['בדקו את האורך בס"מ לפני שאתם מזמינים.']);
    expect(tips).toEqual(["בדקו את האורך בס״מ לפני שאתם מזמינים."]);
  });

  it("keeps at most MAX_TIPS", () => {
    const many = Array.from(
      { length: 7 },
      (_, i) => `${GOOD[0].slice(0, -1)} ${"ש".repeat(i + 1)}.`,
    );
    expect(checkTips(many).tips).toHaveLength(MAX_TIPS);
  });

  it("the prompt's own examples pass the checks", () => {
    const examples = [...TIPS_SYSTEM.matchAll(/\{"tips":(\[.*?\])\}/g)].map(
      (m) => JSON.parse(m[1]) as string[],
    );
    expect(examples.length).toBeGreaterThan(0);
    for (const tips of examples) {
      expect(checkTips(tips).rejected).toEqual([]);
      for (const tip of tips) expect(tip.length).toBeLessThanOrEqual(TIP_MAX);
    }
  });
});

describe("generateCategoryTips", () => {
  it("sends only the category names, at temperature 0", async () => {
    const { llm, requests } = fakeLlm({ tips: GOOD });
    await generateCategoryTips(llm, {
      category: " Portable Audio & Video ",
      parent_category: "Consumer Electronics",
    });
    await generateCategoryTips(llm, { category: "Watches", parent_category: null });

    expect(requests).toHaveLength(2);
    expect(requests[0].system).toBe(TIPS_SYSTEM);
    expect(requests[0].temperature).toBe(0);
    expect(JSON.parse(requests[0].user)).toEqual({
      category: "Portable Audio & Video",
      parent_category: "Consumer Electronics",
    });
    expect(JSON.parse(requests[1].user)).toEqual({ category: "Watches" });
  });

  it("returns the tips that passed", async () => {
    const { llm } = fakeLlm({ tips: [...GOOD, "בדוק את זה לפני שאתה קונה."] });
    const res = await generateCategoryTips(llm, { category: "Earphones", parent_category: null });
    expect(res).toMatchObject({ tips: GOOD, outcome: "ok", model: "fake-1", usage: USAGE });
    expect(res.rejected).toEqual([
      { tip: "בדוק את זה לפני שאתה קונה.", problem: "singular_address" },
    ]);
  });

  it("returns null when fewer than two tips survive", async () => {
    const { llm } = fakeLlm({
      tips: [GOOD[0], "אחריות של 3 שנים היא סימן טוב.", "כבלים של Anker מחזיקים יותר."],
    });
    const res = await generateCategoryTips(llm, { category: "Earphones", parent_category: null });
    expect(res.tips).toBeNull();
    expect(res.outcome).toBe("too_few");
    expect(res.rejected.map((r) => r.problem)).toEqual(["number", "latin_word"]);
  });

  it("reports output that did not match the schema", async () => {
    const { llm } = fakeLlm(null);
    const res = await generateCategoryTips(llm, { category: "Earphones", parent_category: null });
    expect(res).toMatchObject({ tips: null, outcome: "invalid_output", rejected: [] });
  });
});
