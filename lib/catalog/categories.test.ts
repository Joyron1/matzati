import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "@/lib/aliexpress/client";
import { parseCategories, type AliCategory } from "@/lib/aliexpress/schemas";
import { HOT_CATEGORY_IDS, isHotFetchId } from "@/lib/hot/categories";
import { isValidSlug, parseSlugParam } from "@/lib/seo/slug";
import {
  CATALOG,
  DIRECT_FETCH_IDS,
  catalogByFirstLevel,
  catalogByKey,
  catalogBySlug,
  catalogFetchId,
  categoryPath,
  categoryTitle,
} from "./categories";
import { SUBCATEGORY_NAMES_HE, subcategoryNameHe } from "./subcategories";

function categories(): AliCategory[] {
  const method = "aliexpress.affiliate.category.get";
  const text = readFileSync(`fixtures/aliexpress/${method}.json`, "utf8");
  return parseCategories(parseEnvelope(method, parseJsonKeepingIds(text)).result);
}

const ALL = categories();
const FIRST_LEVEL = new Set(ALL.filter((c) => c.parentId === null).map((c) => c.id));
const parentOf = new Map(ALL.map((c) => [c.id, c.parentId]));
// Hebrew letters (with final forms), spaces, the maqaf and a comma; no Latin, no digits.
const HEBREW_NAME = /^[א-ת][א-ת ־,]*[א-ת]$/;

describe("the catalog (/products categories)", () => {
  it("has 16 to 20 categories with unique keys, slugs and names", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(16);
    expect(CATALOG.length).toBeLessThanOrEqual(20);
    for (const field of ["key", "slug", "nameHe"] as const) {
      expect(new Set(CATALOG.map((c) => c[field])).size).toBe(CATALOG.length);
    }
  });

  it("gives every category a valid Hebrew slug and a Hebrew name, title and intro", () => {
    for (const c of CATALOG) {
      expect(isValidSlug(c.slug), c.slug).toBe(true);
      expect(c.slug).toMatch(/^[א-ת]/);
      expect(c.nameHe).toMatch(HEBREW_NAME);
      expect(c.introHe.length).toBeGreaterThan(20);
      expect(c.introHe).not.toMatch(/\d/); // no number we would have to check
      expect(categoryTitle(c)).toBe(`${c.nameHe} מאלי אקספרס שעברו סינון`);
    }
    expect(categoryTitle(catalogBySlug("תכשיטים")!)).toBe("תכשיטים מאלי אקספרס שעברו סינון");
  });

  it("lists only first-level ids of the real category list that the hot loader may fetch", () => {
    for (const c of CATALOG) {
      expect(FIRST_LEVEL.has(c.firstLevelId), c.firstLevelId).toBe(true);
      expect((HOT_CATEGORY_IDS as readonly string[]).includes(c.firstLevelId)).toBe(true);
      expect(isHotFetchId(catalogFetchId(c))).toBe(true);
    }
  });

  it("includes the categories the owner asked for, with the ids from the fixture", () => {
    const wanted: Record<string, string> = {
      תכשיטים: "36",
      שעונים: "1511",
      "צעצועים ומשחקי ילדים": "26",
      "אמא ותינוק": "1501",
      "עיצוב ואביזרי נוי": "15",
      "בית ומטבח": "15",
      "ציוד ספורט ופנאי": "18",
      אלקטרוניקה: "44",
      "אביזרים לטלפון": "202192403",
      "מחשבים ומשרד": "7",
      רכב: "34",
      "יופי וטיפוח": "66",
      "כלי עבודה": "1420",
      תאורה: "39",
      "תיקים ומזוודות": "1524",
      "מכשירי חשמל לבית": "6",
      "אירועים ומסיבות": "15",
      "חיות מחמד": "15",
    };
    for (const [name, id] of Object.entries(wanted)) {
      const c = CATALOG.find((x) => x.nameHe === name);
      expect(c, name).toBeDefined();
      expect(c?.firstLevelId).toBe(id);
    }
  });

  it("makes a slice a real second-level category of its list, fetched by its own id (verified 2026-10-03)", () => {
    const decor = catalogBySlug("עיצוב-ואביזרי-נוי")!;
    expect(decor.slice).toEqual({ subcategoryId: "3710", directFetch: true });
    expect(parentOf.get("3710")).toBe("15");
    expect(decor.key).toBe("3710");
    expect(catalogFetchId(decor)).toBe("3710");
    // Real calls: Home Decor 49 products (38 passed), party supplies 50 (47), pets 49 (41).
    expect([...DIRECT_FETCH_IDS].sort()).toEqual(["100001824", "100006664", "3710"]);
    expect(catalogBySlug("אירועים-ומסיבות")?.slice?.subcategoryId).toBe("100001824");
    expect(catalogBySlug("חיות-מחמד")?.slice?.subcategoryId).toBe("100006664");
    for (const c of CATALOG) {
      if (c.slice) {
        expect(parentOf.get(c.slice.subcategoryId)).toBe(c.firstLevelId);
        expect(c.key).toBe(c.slice.subcategoryId);
      } else {
        expect(c.key).toBe(c.firstLevelId);
      }
    }
  });

  it("finds a category by slug, key and first-level id, and nothing else", () => {
    expect(catalogBySlug("תכשיטים")?.firstLevelId).toBe("36");
    expect(catalogBySlug("nope")).toBeNull();
    expect(catalogByKey("3710")?.nameHe).toBe("עיצוב ואביזרי נוי");
    expect(catalogByKey("2")).toBeNull();
    // The whole list, never the slice, for a first-level id.
    expect(catalogByFirstLevel("15")?.slug).toBe("בית-ומטבח");
    expect(catalogByFirstLevel("2")).toBeNull();
  });

  it("percent-encodes the path, and the route reads it back", () => {
    for (const c of CATALOG) {
      const path = categoryPath(c);
      expect(path).toMatch(/^\/products\/[A-Za-z0-9%-]+$/);
      expect(parseSlugParam(path.slice("/products/".length))).toBe(c.slug);
      expect(catalogBySlug(parseSlugParam(path.slice("/products/".length)) ?? "")).toBe(c);
    }
  });
});

describe("sub-category names", () => {
  it("names only second-level ids of the catalog's first-level categories", () => {
    for (const [first, names] of Object.entries(SUBCATEGORY_NAMES_HE)) {
      expect(
        CATALOG.some((c) => c.firstLevelId === first),
        first,
      ).toBe(true);
      for (const [id, name] of Object.entries(names)) {
        expect(parentOf.get(id), `${first}/${id}`).toBe(first);
        expect(name, id).toMatch(HEBREW_NAME);
      }
      // Two pills of one category never read the same.
      expect(new Set(Object.values(names)).size).toBe(Object.keys(names).length);
    }
  });

  it("names every second-level category of every catalog list, but adult, vaping and 'Other'", () => {
    const unnamed = new Set([
      "200001508", // Sex Products
      "200003561", // Electronic Cigarettes
    ]);
    for (const first of new Set(CATALOG.map((c) => c.firstLevelId))) {
      for (const c of ALL.filter((x) => x.parentId === first)) {
        if (unnamed.has(c.id) || /^Other /.test(c.name)) {
          expect(subcategoryNameHe(first, c.id), c.name).toBeNull();
        } else {
          expect(subcategoryNameHe(first, c.id), `${first}/${c.id} ${c.name}`).not.toBeNull();
        }
      }
    }
  });

  it("reads own keys only", () => {
    expect(subcategoryNameHe("15", "3710")).toBe("עיצוב הבית");
    expect(subcategoryNameHe("15", "constructor")).toBeNull();
    expect(subcategoryNameHe("__proto__", "3710")).toBeNull();
  });
});
