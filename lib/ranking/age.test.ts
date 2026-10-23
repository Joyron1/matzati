import { describe, expect, it } from "vitest";
import { ageFits, titleMinAge } from "./age";

describe("titleMinAge", () => {
  it.each([
    ["Building Blocks Set 14+ Years Adult Collection", 14],
    ["RC Car For Kids Ages 8+ Gift", 8],
    ["Magnetic Tiles for Kids Age 3-6 Montessori", 3],
    ["Drawing Board 3 to 8 years old Toddler", 3],
    ["Puzzle 1000 Pieces 12 Years and Up", 12],
    ["Remote Control Car 2.4G Drift Racing Toy", null],
    // Numbers that are not ages.
    ["RC Car 1:16 Scale 4WD 30km/h 2 Batteries", null],
    ["Toy Set 3+1 Pieces", null],
  ])("%s → %s", (title, age) => {
    expect(titleMinAge(title)).toBe(age);
  });

  it("takes the smallest stated minimum", () => {
    expect(titleMinAge("For Ages 6+ and 8+ Years")).toBe(6);
  });
});

describe("ageFits", () => {
  it("keeps out toys stated for older children, keeps the rest", () => {
    expect(ageFits("Model Kit 14+ Years", 5)).toBe(false);
    expect(ageFits("Blocks Ages 3-6", 5)).toBe(true);
    expect(ageFits("Stacking Toy", 5)).toBe(true);
  });
});
