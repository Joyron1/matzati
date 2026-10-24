import { describe, expect, it } from "vitest";
import {
  addSaved,
  clearSaved,
  forgetProduct,
  parseSaved,
  readSaved,
  removeSaved,
  SAVED_KEY,
  SAVED_MAX,
  saveProduct,
} from "./mine";

const P = {
  id: "1005006338829917",
  title: "אוזניות אלחוטיות",
  image: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
  price: 89,
  original: 149,
};

function fakeStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("parseSaved", () => {
  it("reads a stored list, newest first, once per product", () => {
    const raw = JSON.stringify([
      { ...P, at: 1 },
      { ...P, id: "1005000000000002", at: 3 },
      { ...P, at: 2 },
    ]);
    expect(parseSaved(raw).map((p) => [p.id, p.at])).toEqual([
      ["1005000000000002", 3],
      [P.id, 2],
    ]);
  });

  it("drops anything malformed, never throws", () => {
    expect(parseSaved("not json")).toEqual([]);
    expect(parseSaved(JSON.stringify({ a: 1 }))).toEqual([]);
    const raw = JSON.stringify([
      { ...P, id: "abc", at: 1 },
      { ...P, price: "89", at: 1 },
      { ...P, title: "", at: 1 },
      { ...P, image: "javascript:alert(1)", at: 5 },
    ]);
    // Only the last one is a product; its unsafe image is dropped.
    expect(parseSaved(raw)).toEqual([{ ...P, image: "", at: 5 }]);
  });

  it("keeps an original price only above the price", () => {
    expect(parseSaved(JSON.stringify([{ ...P, original: 50, at: 1 }]))[0].original).toBeNull();
  });
});

describe("the list", () => {
  it("adds to the top, replaces an older entry, and caps at SAVED_MAX", () => {
    let list = addSaved([], P, 1);
    list = addSaved(list, { ...P, id: "1005000000000002" }, 2);
    list = addSaved(list, P, 3);
    expect(list.map((p) => p.id)).toEqual([P.id, "1005000000000002"]);
    for (let i = 0; i < SAVED_MAX + 5; i++) {
      list = addSaved(list, { ...P, id: String(1005000000000100 + i) }, 10 + i);
    }
    expect(list).toHaveLength(SAVED_MAX);
    expect(removeSaved(list, list[0].id)).toHaveLength(SAVED_MAX - 1);
  });

  it("saves to, reads from and clears the browser store", () => {
    const store = fakeStore();
    saveProduct(P, store);
    expect(readSaved(store).map((p) => p.id)).toEqual([P.id]);
    forgetProduct(P.id, store);
    expect(store.data.has(SAVED_KEY)).toBe(false);
    saveProduct(P, store);
    clearSaved(store);
    expect(readSaved(store)).toEqual([]);
  });

  it("reads nothing when there is no store (private mode, blocked site data)", () => {
    expect(readSaved(null)).toEqual([]);
  });
});
