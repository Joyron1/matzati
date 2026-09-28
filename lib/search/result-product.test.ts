import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { toResultProduct } from "./pipeline";

// A card of the live run of 2026-09-28 (fixtures/llm/eval-v3-2026-09-28-subset.json, home-drawer).
const tray: AliProduct = {
  productId: "1005013004164872",
  title:
    "UpgradedAdjustable Plastic Cutlery Drawer Organizer Divided Storage Tray Space Saving Holder for Kitchen Knives Spoons Tableware",
  price: 16.93,
  originalPrice: null,
  currency: "ILS",
  discountPct: null,
  positiveFeedbackPct: 100,
  unitsSold: 370,
  mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
  imageUrls: [],
  detailUrl: "https://he.aliexpress.com/item/1005013004164872.html",
  promotionLink: null,
  shop: { id: null, name: null, url: null },
  commissionRatePct: null,
  category: { firstId: null, firstName: null, secondId: null, secondName: null },
};

describe("toResultProduct", () => {
  it("reads a cached title and line with the known transliterations fixed", () => {
    const out = toResultProduct(tray, {
      title_he: "מארגן סכו״ם לדרור",
      why_he: "מארגן כלים וטבלוואר למטבח עם משוב חיובי של 100% בקרב 370 קונים.",
    });
    expect(out.title_he).toBe("מארגן סכו״ם למגירה");
    expect(out.why_he).toBe("מארגן כלים וכלי אוכל למטבח עם משוב חיובי של 100% בקרב 370 קונים.");
  });

  it("keeps a line without one, and no line as none", () => {
    const line = "מארגן מגירה לסכו״ם, 100% משוב חיובי ו־370 נמכרו ב־30 הימים האחרונים.";
    expect(toResultProduct(tray, { title_he: null, why_he: line }).why_he).toBe(line);
    expect(toResultProduct(tray, undefined).why_he).toBe("");
  });
});
