import { describe, expect, it } from "vitest";
import { categoryLabelHe, tipsCategoryOf } from "./category";

const category = (c: Partial<Parameters<typeof tipsCategoryOf>[0]>) => ({
  firstId: null,
  firstName: null,
  secondId: null,
  secondName: null,
  ...c,
});

describe("tipsCategoryOf", () => {
  it("prefers the second-level category, with its parent's name", () => {
    expect(
      tipsCategoryOf(
        category({
          firstId: "44",
          firstName: "Consumer Electronics",
          secondId: "100000306",
          secondName: "Portable Audio & Video",
        }),
      ),
    ).toEqual({
      id: "100000306",
      nameEn: "Portable Audio & Video",
      parentEn: "Consumer Electronics",
    });
  });

  it("falls back to the first-level category", () => {
    expect(tipsCategoryOf(category({ firstId: "1511", firstName: " Watches " }))).toEqual({
      id: "1511",
      nameEn: "Watches",
      parentEn: null,
    });
  });

  it("skips products without a category id or name", () => {
    expect(tipsCategoryOf(category({}))).toBeNull();
    expect(tipsCategoryOf(category({ firstName: "Watches" }))).toBeNull();
    expect(tipsCategoryOf(category({ firstId: "1511", secondId: "200000121" }))).toBeNull();
  });

  it("skips test, non-product and adult categories", () => {
    expect(
      tipsCategoryOf(category({ firstId: "201169612", firstName: "Virtual Products" })),
    ).toBeNull();
    expect(
      tipsCategoryOf(
        category({
          firstId: "66",
          firstName: "Beauty & Health",
          secondId: "200001508",
          secondName: "Sex Products",
        }),
      ),
    ).toBeNull();
  });
});

describe("categoryLabelHe", () => {
  it("names known categories in Hebrew and nothing else", () => {
    expect(categoryLabelHe("1511")).toBe("שעונים");
    expect(categoryLabelHe("200000121")).toBe("אביזרים לשעונים");
    expect(categoryLabelHe("999999999")).toBeNull();
    expect(categoryLabelHe("toString")).toBeNull();
  });
});
