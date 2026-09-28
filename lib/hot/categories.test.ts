import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "@/lib/aliexpress/client";
import { parseCategories } from "@/lib/aliexpress/schemas";
import {
  HOT_CATEGORY_IDS,
  MIX_CATEGORY_IDS,
  hotCategories,
  hotCategoryLabel,
  isHotCategoryId,
} from "./categories";

function firstLevelIds(): string[] {
  const method = "aliexpress.affiliate.category.get";
  const text = readFileSync(`fixtures/aliexpress/${method}.json`, "utf8");
  return parseCategories(parseEnvelope(method, parseJsonKeepingIds(text)).result)
    .filter((c) => c.parentId === null)
    .map((c) => c.id);
}

describe("hot categories", () => {
  it("offers 8 to 12 distinct first-level categories from the real category list", () => {
    expect(HOT_CATEGORY_IDS.length).toBeGreaterThanOrEqual(8);
    expect(HOT_CATEGORY_IDS.length).toBeLessThanOrEqual(12);
    expect(new Set(HOT_CATEGORY_IDS).size).toBe(HOT_CATEGORY_IDS.length);
    const firstLevel = firstLevelIds();
    for (const id of HOT_CATEGORY_IDS) expect(firstLevel).toContain(id);
  });

  it("names every pill in Hebrew", () => {
    expect(hotCategories().map((c) => c.id)).toEqual([...HOT_CATEGORY_IDS]);
    for (const c of hotCategories()) {
      expect(c.labelHe).toMatch(/^[֐-׿][֐-׿ ־]*$/);
    }
    expect(hotCategoryLabel("44")).toBe("מוצרי אלקטרוניקה");
    expect(hotCategoryLabel("2")).toBeNull(); // named for tips, but not a hot category
  });

  it("mixes a few distinct pill categories (one call each when cold)", () => {
    expect(MIX_CATEGORY_IDS.length).toBeGreaterThanOrEqual(3);
    expect(MIX_CATEGORY_IDS.length).toBeLessThanOrEqual(5);
    expect(new Set(MIX_CATEGORY_IDS).size).toBe(MIX_CATEGORY_IDS.length);
    // Not the phone accessories list: mostly phone cases.
    expect(MIX_CATEGORY_IDS).not.toContain("202192403");
  });

  it("accepts only the curated ids", () => {
    expect(isHotCategoryId("44")).toBe(true);
    for (const id of ["2", "", "all", "44 "]) expect(isHotCategoryId(id)).toBe(false);
  });
});
