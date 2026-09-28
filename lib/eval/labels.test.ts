import { describe, expect, it } from "vitest";
import { buildLabelBook, isGoodLabel, labelLetter, labelsFor, parseLabelFile } from "./labels";

const entry = (productId: string, label: string, note?: string) => ({
  productId,
  label,
  ...(note === undefined ? {} : { note }),
});

describe("parseLabelFile", () => {
  it("reads an array as the labels of the query the file is named after", () => {
    const m = parseLabelFile("car-holder", [entry("1", "exact", "a holder"), entry("2", "wrong")]);
    expect([...m.keys()]).toEqual(["car-holder"]);
    expect(m.get("car-holder")).toEqual([
      { productId: "1", label: "exact", note: "a holder" },
      { productId: "2", label: "wrong", note: "" },
    ]);
  });

  it("reads { id, labels } and { <query id>: [...] } files", () => {
    expect([
      ...parseLabelFile("file", { id: "pair-a", labels: [entry("1", "weak")] }).keys(),
    ]).toEqual(["pair-a"]);
    expect([...parseLabelFile("file", { labels: [entry("1", "weak")] }).keys()]).toEqual(["file"]);
    const many = parseLabelFile("all", { a: [entry("1", "exact")], b: [entry("2", "wrong")] });
    expect([...many.keys()]).toEqual(["a", "b"]);
  });

  it('accepts "acceptable" as reasonable and any letter case', () => {
    const m = parseLabelFile("q", [entry("1", "acceptable"), entry("2", "Exact")]);
    expect(m.get("q")!.map((e) => e.label)).toEqual(["reasonable", "exact"]);
  });

  it("rejects unknown labels and numeric ids, naming the file and field", () => {
    expect(() => parseLabelFile("q", [entry("1", "great")])).toThrow(/labels q: 0\.label/);
    expect(() => parseLabelFile("q", [{ productId: 1005, label: "exact" }])).toThrow(
      /labels q: 0\.productId/,
    );
  });
});

describe("buildLabelBook", () => {
  it("merges files and keeps one entry per product", () => {
    const book = buildLabelBook([
      { fileId: "q", json: [entry("1", "exact")] },
      { fileId: "other", json: { q: [entry("1", "exact"), entry("2", "weak")] } },
    ]);
    expect([...book.get("q")!.keys()]).toEqual(["1", "2"]);
  });

  it("throws on two different labels for the same product and query", () => {
    expect(() =>
      buildLabelBook([
        { fileId: "q", json: [entry("1", "exact")] },
        { fileId: "r", json: { q: [entry("1", "wrong")] } },
      ]),
    ).toThrow(/is both "exact" and "wrong"/);
  });
});

describe("labelsFor", () => {
  it("falls back to the labels of the snapshot a copy repeats", () => {
    const book = buildLabelBook([{ fileId: "pair-a", json: [entry("1", "exact")] }]);
    expect(labelsFor(book, { id: "ex-1", sameQueryAs: "pair-a" })?.get("1")?.label).toBe("exact");
    expect(labelsFor(book, { id: "ex-2", sameQueryAs: null })).toBeNull();
  });
});

describe("label helpers", () => {
  it("counts exact and reasonable as good, and has a letter per label", () => {
    expect(
      ["exact", "reasonable", "weak", "wrong", null].map((l) => isGoodLabel(l as never)),
    ).toEqual([true, true, false, false, false]);
    expect(
      ["exact", "reasonable", "weak", "wrong", null].map((l) => labelLetter(l as never)),
    ).toEqual(["E", "R", "w", "X", "?"]);
  });
});
