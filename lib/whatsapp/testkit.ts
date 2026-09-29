import { expect } from "vitest";
import type { ResultProduct } from "@/lib/types";
import { LIMITS, type WaMessage } from "./messages";

const chars = (s: string) => [...s].length;

/** Every limit Meta documents for the message's type (checked 2026-09-29). */
export function assertWithinLimits(m: WaMessage): void {
  if (m.type === "text")
    return void expect(chars(m.text.body)).toBeLessThanOrEqual(LIMITS.textBody);
  const i = m.interactive;
  if (i.footer) expect(chars(i.footer.text)).toBeLessThanOrEqual(LIMITS.footer);
  if (i.header?.type === "text")
    expect(chars(i.header.text)).toBeLessThanOrEqual(LIMITS.headerText);
  if (i.type === "cta_url") {
    expect(chars(i.body.text)).toBeLessThanOrEqual(LIMITS.ctaBody);
    expect(chars(i.action.parameters.display_text)).toBeLessThanOrEqual(LIMITS.ctaLabel);
    expect(i.action.parameters.url).toMatch(/^https:\/\//);
  } else if (i.type === "button") {
    expect(chars(i.body.text)).toBeLessThanOrEqual(LIMITS.buttonsBody);
    expect(i.action.buttons.length).toBeGreaterThanOrEqual(1);
    expect(i.action.buttons.length).toBeLessThanOrEqual(LIMITS.buttons);
    for (const b of i.action.buttons) {
      expect(chars(b.reply.title)).toBeLessThanOrEqual(LIMITS.buttonTitle);
      expect(chars(b.reply.id)).toBeLessThanOrEqual(256);
    }
  } else {
    expect(chars(i.body.text)).toBeLessThanOrEqual(LIMITS.listBody);
    expect(chars(i.action.button)).toBeLessThanOrEqual(LIMITS.listButton);
    const rows = i.action.sections.flatMap((s) => s.rows);
    expect(rows.length).toBeLessThanOrEqual(LIMITS.rows);
    expect(i.action.sections.length).toBeLessThanOrEqual(10);
    for (const s of i.action.sections)
      expect(chars(s.title)).toBeLessThanOrEqual(LIMITS.sectionTitle);
    for (const r of rows) {
      expect(chars(r.title)).toBeLessThanOrEqual(LIMITS.rowTitle);
      expect(chars(r.description ?? "")).toBeLessThanOrEqual(LIMITS.rowDescription);
      expect(chars(r.id)).toBeLessThanOrEqual(200);
    }
  }
}

export const product = (over: Partial<ResultProduct & { search_uid: string }> = {}) =>
  ({
    product_id: "1005007429991325",
    title_he: "אוזניות ספורט Bluetooth עמידות למים",
    title_en: "Sport earbuds",
    why_he: "אוזניות ספורט עמידות למים לריצה, 346 נמכרו ב־30 הימים האחרונים.",
    price_ils: 9.87,
    original_price_ils: 12.5,
    price_is_approx: false,
    discount_pct: 21,
    positive_feedback_pct: 98,
    units_sold: 346,
    passed_tier: "standard",
    image_urls: ["https://ae-pic-a1.aliexpress-media.com/kf/S123.jpg"],
    category_id: "44",
    search_uid: "0b0c6ce2-6d0e-4b8d-9d55-1d7a5a3a3a3a",
    ...over,
  }) as ResultProduct & { search_uid: string };
