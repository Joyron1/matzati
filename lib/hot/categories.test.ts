import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "@/lib/aliexpress/client";
import { parseCategories } from "@/lib/aliexpress/schemas";
import { CATALOG } from "@/lib/catalog/categories";
import {
  CAROUSEL_CATEGORY_IDS,
  HOT_CATEGORY_IDS,
  HOT_MAX_LIST_PAGES,
  MIX_CATEGORY_IDS,
  hotCategories,
  hotCategoryLabel,
  hotListKey,
  isHotCategoryId,
  isHotFetchId,
  parseHotListKey,
} from "./categories";

function firstLevelIds(): string[] {
  const method = "aliexpress.affiliate.category.get";
  const text = readFileSync(`fixtures/aliexpress/${method}.json`, "utf8");
  return parseCategories(parseEnvelope(method, parseJsonKeepingIds(text)).result)
    .filter((c) => c.parentId === null)
    .map((c) => c.id);
}

describe("hot categories", () => {
  it("offers the catalog's distinct first-level categories from the real category list", () => {
    expect(HOT_CATEGORY_IDS.length).toBeGreaterThanOrEqual(12);
    expect(HOT_CATEGORY_IDS.length).toBeLessThanOrEqual(20);
    expect(new Set(HOT_CATEGORY_IDS).size).toBe(HOT_CATEGORY_IDS.length);
    const firstLevel = firstLevelIds();
    for (const id of HOT_CATEGORY_IDS) expect(firstLevel).toContain(id);
  });

  it("names every hot category in Hebrew with its catalog name", () => {
    expect(new Set(hotCategories().map((c) => c.id))).toEqual(new Set(HOT_CATEGORY_IDS));
    // Every hot category has a whole-list catalog page, and the catalog lists nothing else.
    expect(new Set(CATALOG.map((c) => c.firstLevelId))).toEqual(new Set(HOT_CATEGORY_IDS));
    for (const c of hotCategories()) {
      expect(c.labelHe).toMatch(/^[֐-׿][֐-׿ ־]*$/);
    }
    expect(hotCategoryLabel("44")).toBe("אלקטרוניקה");
    expect(hotCategoryLabel("15")).toBe("בית ומטבח"); // the whole list, not its decor slice
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
  it("keeps the carousel's warm-up to the categories /hot had", () => {
    expect(CAROUSEL_CATEGORY_IDS).toHaveLength(12);
    for (const id of CAROUSEL_CATEGORY_IDS) expect(isHotCategoryId(id)).toBe(true);
    for (const id of ["36", "1511", "1524"]) {
      expect((CAROUSEL_CATEGORY_IDS as readonly string[]).includes(id)).toBe(false);
    }
  });
});

describe("hot list keys (pages of one list)", () => {
  it("keys page 1 by the id alone, so the lists cached before pages existed stay valid", () => {
    expect(hotListKey("44")).toBe("44");
    expect(hotListKey("44", 1)).toBe("44");
    expect(hotListKey("44", 2)).toBe("44:2");
    expect(hotListKey("44", 3)).toBe("44:3");
  });

  it("caps the pages at HOT_MAX_LIST_PAGES (3), whatever is asked", () => {
    expect(HOT_MAX_LIST_PAGES).toBe(3);
    for (const page of [0, -1, 4, 50, 2.5, Number.NaN]) {
      expect(["44", "44:2"]).toContain(hotListKey("44", page));
    }
    expect(hotListKey("44", 4)).toBe("44");
    expect(hotListKey("44", 99)).toBe("44");
  });

  it("parses only allowed ids and pages 1 to 3", () => {
    expect(parseHotListKey("44")).toEqual({ id: "44", page: 1 });
    expect(parseHotListKey("36:3")).toEqual({ id: "36", page: 3 });
    for (const key of ["44:1", "44:4", "44:0", "2", "2:2", "200001508", "", "44 ", "a", "320"]) {
      expect(parseHotListKey(key)).toBeNull();
    }
  });

  it("fetches a second-level id only for a catalog slice with direct fetch on", () => {
    expect(isHotFetchId("15")).toBe(true);
    for (const id of ["3710", "100001824", "100006664"]) expect(isHotFetchId(id)).toBe(true);
    // Any other second-level id, and the dropped Weddings & Events list, never.
    for (const id of ["405", "200001508", "320"]) expect(isHotFetchId(id)).toBe(false);
  });
});
