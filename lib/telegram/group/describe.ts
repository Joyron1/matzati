// A clean short name and a one-line description for each product of a search group answer (owner
// request 2026-10-27: AliExpress's machine-translated titles read badly, and members want to know
// what each product is). One call to the cheap model for the five (about $0.001), from each
// product's title only: AliExpress gives affiliates no description, and nothing is invented. Code
// checks every answer (Hebrew, lengths, no number the title does not have, no price or rating
// words); a failed check or call keeps AliExpress's title and no line.
import { z } from "zod";
import type { LlmProvider } from "@/lib/llm/provider";

export const NAME_MAX = 45;
export const LINE_MAX = 70;

export const DESCRIBE_SYSTEM = `You write for an Israeli shopping bot. For each product you get its AliExpress title (Hebrew machine translation, or English). Write in natural Hebrew:
- name_he: what the product is, the way an Israeli shopper would call it: 2-6 words, at most ${NAME_MAX} characters. Keep a brand or model name as written.
- line_he: one short sentence, at most ${LINE_MAX} characters, saying what it is or what it does, using ONLY facts the title states (material, size, count, use). If the title says little, describe the product type plainly.
Never write a price, a rating, a sales number, "best", "cheapest", "high quality" or any claim the title does not make; no emojis; no English except a brand or model name. Plural, gender-neutral style.`;

const schema = z.object({
  items: z.array(z.object({ id: z.string(), name_he: z.string(), line_he: z.string() })),
});

export interface Described {
  name: string;
  line: string | null;
}

const HEBREW = /[֐-׿]/;
const BANNED =
  /(₪|ש״ח|ש"ח|מחיר|דירוג|כוכב|משוב|נמכר|מכירות|הכי |הטוב ביותר|הזול|איכותי|איכות גבוהה|מבצע)/;

/** Every number the text has appears in the title (no invented size, count or spec). Pure. */
export function numbersGrounded(text: string, title: string): boolean {
  const nums = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const source = title.replace(/,/g, ".");
  return nums.every((n) => source.includes(n.replace(/,/g, ".")));
}

/** The model's answer for one product, checked; null when it does not hold. Pure. */
export function checkDescribed(
  out: { name_he: string; line_he: string },
  title: string,
): Described | null {
  const name = out.name_he.replace(/\s+/g, " ").trim();
  const line = out.line_he.replace(/\s+/g, " ").trim();
  const ok = (t: string, max: number) =>
    t.length >= 2 &&
    t.length <= max &&
    HEBREW.test(t) &&
    !BANNED.test(t) &&
    numbersGrounded(t, title);
  if (!ok(name, NAME_MAX)) return null;
  return { name, line: ok(line, LINE_MAX) ? line : null };
}

export async function describeProducts(
  llm: LlmProvider,
  products: { id: string; title: string }[],
): Promise<Map<string, Described>> {
  const out = new Map<string, Described>();
  if (!products.length) return out;
  try {
    const res = await llm.generateStructured({
      system: DESCRIBE_SYSTEM,
      user: JSON.stringify(products.map((p) => ({ id: p.id, title: p.title.slice(0, 300) }))),
      schema,
      maxTokens: 900,
      timeoutMs: 12_000,
      maxRetries: 1,
    });
    for (const item of res.data?.items ?? []) {
      const p = products.find((x) => x.id === item.id);
      if (!p) continue;
      const d = checkDescribed(item, p.title);
      if (d) out.set(p.id, d);
    }
  } catch {
    // The answer goes out with AliExpress's titles.
  }
  return out;
}
