import { describe, expect, it } from "vitest";
import {
  addMySearch,
  clearMySearches,
  forgetMySearch,
  MY_SEARCHES_KEY,
  MY_SEARCHES_MAX,
  mySearchKey,
  parseMySearches,
  readMySearches,
  rememberMySearch,
  removeMySearch,
  type MySearch,
} from "./mine";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("my searches (pure)", () => {
  it("adds newest first and moves a repeated query to the top, as typed the last time", () => {
    let list: MySearch[] = [];
    list = addMySearch(list, "מנורת לילה", 1);
    list = addMySearch(list, "כבל USB", 2);
    list = addMySearch(list, "  מנורת   לילה ", 3);
    expect(list).toEqual([
      { q: "מנורת לילה", at: 3 },
      { q: "כבל USB", at: 2 },
    ]);
    // Case, niqqud and quotes do not make another entry.
    list = addMySearch(list, "כבל usb", 4);
    expect(list.map((s) => s.q)).toEqual(["כבל usb", "מנורת לילה"]);
    expect(mySearchKey("מְנוֹרָה 50 ש״ח")).toBe(mySearchKey("מנורה 50 שח"));
  });

  it("keeps at most 12, dropping the oldest", () => {
    let list: MySearch[] = [];
    for (let i = 0; i < MY_SEARCHES_MAX + 3; i++) list = addMySearch(list, `חיפוש ${i}`, i);
    expect(MY_SEARCHES_MAX).toBe(12);
    expect(list).toHaveLength(MY_SEARCHES_MAX);
    expect(list[0].q).toBe(`חיפוש ${MY_SEARCHES_MAX + 2}`);
    expect(list.at(-1)?.q).toBe("חיפוש 3");
  });

  it("ignores an empty query", () => {
    expect(addMySearch([], "   ", 1)).toEqual([]);
  });

  it("removes one query", () => {
    const list = addMySearch(addMySearch([], "א ב", 1), "ג ד", 2);
    expect(removeMySearch(list, "א  ב")).toEqual([{ q: "ג ד", at: 2 }]);
  });

  it("reads corrupted or foreign JSON as an empty or cleaned list", () => {
    expect(parseMySearches(null)).toEqual([]);
    expect(parseMySearches("")).toEqual([]);
    expect(parseMySearches("{not json")).toEqual([]);
    expect(parseMySearches('{"q":"x"}')).toEqual([]);
    expect(parseMySearches("42")).toEqual([]);
    expect(
      parseMySearches(
        JSON.stringify([
          { q: "ישן", at: 1 },
          null,
          "str",
          { q: 5, at: 2 },
          { q: "בלי זמן" },
          { q: "x", at: "3" },
          { q: "  ", at: 4 },
          { q: "חדש", at: 9 },
          { q: "ישן", at: 7 },
        ]),
      ),
    ).toEqual([
      { q: "חדש", at: 9 },
      { q: "ישן", at: 7 },
    ]);
    const many = Array.from({ length: 30 }, (_, i) => ({ q: `q${i}`, at: i }));
    expect(parseMySearches(JSON.stringify(many))).toHaveLength(MY_SEARCHES_MAX);
  });
});

describe("my searches (storage)", () => {
  it("remembers, forgets one and clears all under its key", () => {
    const store = fakeStorage();
    rememberMySearch("כבל USB", store);
    rememberMySearch("מנורה", store);
    expect(readMySearches(store).map((s) => s.q)).toEqual(["מנורה", "כבל USB"]);
    expect(JSON.parse(store.data.get(MY_SEARCHES_KEY)!)).toHaveLength(2);
    forgetMySearch("מנורה", store);
    expect(readMySearches(store).map((s) => s.q)).toEqual(["כבל USB"]);
    clearMySearches(store);
    expect(store.data.has(MY_SEARCHES_KEY)).toBe(false);
    expect(readMySearches(store)).toEqual([]);
  });

  it("never throws when storage is blocked or missing", () => {
    expect(readMySearches(throwing)).toEqual([]);
    expect(() => rememberMySearch("x", throwing)).not.toThrow();
    expect(() => forgetMySearch("x", throwing)).not.toThrow();
    expect(() => clearMySearches(throwing)).not.toThrow();
    expect(readMySearches(null)).toEqual([]);
    expect(() => rememberMySearch("x", null)).not.toThrow();
  });

  it("starts over from a corrupted value", () => {
    const store = fakeStorage({ [MY_SEARCHES_KEY]: "][" });
    rememberMySearch("שעון חכם", store);
    expect(readMySearches(store).map((s) => s.q)).toEqual(["שעון חכם"]);
  });
});
