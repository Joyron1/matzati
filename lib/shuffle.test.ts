import { describe, expect, it } from "vitest";
import { seededRandom, shuffled } from "./shuffle";

describe("shuffled", () => {
  it("keeps every item once and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffled(input, seededRandom(0.42));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives the same order for the same seed and another for another seed", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffled(input, seededRandom(0.1))).toEqual(shuffled(input, seededRandom(0.1)));
    expect(shuffled(input, seededRandom(0.1))).not.toEqual(shuffled(input, seededRandom(0.9)));
  });
});
