import { describe, expect, it } from "vitest";
import type { Requirement, SearchFilters } from "@/lib/search/filters";
import { RELEVANCE } from "./config";
import {
  asksForSmall,
  coverageWords,
  preferenceFit,
  relevance,
  statesPreference,
  titleSaysPhrase,
} from "./relevance";
import { agePhrases } from "@/lib/llm/parse";

const req = (en: string, alt: string[] = []): Requirement => ({ en, alt, he: "דרישה" });

type RelevanceFilters = Pick<SearchFilters, "keywords_en" | "product_terms" | "requirements">;

// Recorded parses (fixtures/snapshots).
const drawerOrganizer: RelevanceFilters = {
  keywords_en: "drawer organizer storage",
  product_terms: ["drawer organizer", "drawer divider", "storage organizer"],
  requirements: [],
};
const neckPillow: RelevanceFilters = {
  keywords_en: "neck pillow travel",
  product_terms: ["neck pillow", "travel pillow", "airplane pillow"],
  requirements: [],
};
const earbuds: RelevanceFilters = {
  keywords_en: "waterproof running earbuds",
  product_terms: ["running earbuds", "sports earbuds", "running headphones"],
  requirements: [req("waterproof", ["water resistant", "ipx"])],
};

describe("coverageWords", () => {
  it("keeps the product words and leaves out requirement and empty words", () => {
    expect(coverageWords(earbuds)).toEqual(["running", "earbud"]);
    expect(
      coverageWords({
        keywords_en: "best 65w fast charger for laptop",
        requirements: [req("65w")],
      }),
    ).toEqual(["fast", "charg", "laptop"]);
  });
});

describe("relevance", () => {
  it("is 0 for a title that is not the product, and 1 for the plainest one", () => {
    expect(relevance("Car Under Seat Storage Box ABS Drawer Organizer", drawerOrganizer)).toBe(0);
    expect(relevance("Travel Neck Pillow Memory Foam", neckPillow)).toBeCloseTo(1);
  });

  it("ranks a drawer organizer above a storage box that has drawers", () => {
    // Real live-drawer-organizer titles: exact, and wrong (it has drawers; it is not for one).
    const organizer = relevance(
      "Cabinet Underwear Organizer Drawer Clothes Organizer Boxes Closet Organizer for Underwear Bra",
      drawerOrganizer,
    );
    const hasDrawers = relevance(
      "3-Tier Plastic Cosmetic Storage Box Organizer with Drawers Multifunctional Countertop Storage",
      drawerOrganizer,
    );
    expect(organizer - hasDrawers).toBeGreaterThanOrEqual(RELEVANCE.primaryTerm);
  });

  it("prefers the product named at the head of the title", () => {
    const head = relevance("Travel Neck Pillow Memory Foam Soft", neckPillow);
    const late = relevance(
      "Soft Slow Rebound Memory Foam Outdoor Camping Noon Break Sleeping Travel Neck Pillow",
      neckPillow,
    );
    expect(head).toBeGreaterThan(late);
  });

  it("lowers a product made for an object the search did not name", () => {
    const plain = relevance("Travel Neck Pillow Memory Foam Soft Support", neckPillow);
    const tesla = relevance("Travel Neck Pillow Memory Foam Soft Support for Tesla", neckPillow);
    expect(plain - tesla).toBeCloseTo(RELEVANCE.subject);
  });

  it("counts a synonym of a search word as covering it", () => {
    const f = { ...earbuds, product_terms: ["running earbuds"] };
    // "Earphones" covers "earbuds"; only the position differs.
    expect(relevance("Running Earphones Waterproof", f)).toBeCloseTo(
      relevance("Running Earbuds Waterproof", f) - RELEVANCE.primaryTerm,
    );
  });
});

describe("asksForSmall", () => {
  it("reads small, mini and compact in the keywords or product terms", () => {
    expect(asksForSmall({ keywords_en: "mini power bank", product_terms: ["power bank"] })).toBe(
      true,
    );
    expect(asksForSmall({ keywords_en: "power bank", product_terms: ["small power bank"] })).toBe(
      true,
    );
    expect(
      asksForSmall({ keywords_en: "power bank 10000mah", product_terms: ["power bank"] }),
    ).toBe(false);
  });
});

describe("preferences as whole phrases (an age or number for a birthday)", () => {
  const three = { words: agePhrases(3), he: "יום הולדת 3" };

  it("reads the phrases sellers title a number with", () => {
    for (const title of [
      "Sonic Balloons Number 3 Foil Balloon Birthday Party Decoration",
      "Sonic 3rd Birthday Party Balloons Set",
      "Happy Third Birthday Sonic Balloon Kit",
      "Sonic Balloons for 3 Years Old Boy Birthday",
      "Sonic Hedgehog Balloon 3-Year-Old Birthday",
      "Number-3 Gold Foil Balloon Sonic",
    ]) {
      expect(statesPreference(title, three)).toBe(true);
    }
  });

  it("never matches another number, a count, a size or a range", () => {
    for (const title of [
      "Sonic Balloons 3pcs Birthday Party",
      "Sonic Foil Balloon 3m Ribbon",
      "3 in 1 Sonic Balloon Set Birthday",
      "Sonic Balloons for 1-3 Years Kids",
      "Sonic Number 30 Balloon",
      "Sonic Number 3-5 Candles",
      "Sonic 13th Birthday Balloons",
      "Sonic Balloons 3.5 inch",
      "Sonic Balloons 23 Years Anniversary",
    ]) {
      expect(statesPreference(title, three)).toBe(false);
    }
    expect(titleSaysPhrase("Number 3 Balloon", "number 3")).toBe(true);
    expect(titleSaysPhrase("Number 35 Balloon", "number 3")).toBe(false);
  });

  it("never counts a phrase's words one by one toward the coverage", () => {
    const f = {
      keywords_en: "sonic birthday balloons",
      requirements: [req("sonic")],
      preferences: [three],
    };
    expect(coverageWords(f)).toEqual(["birthday", "balloon"]);
  });

  it("is the share of the search's preferences a title states", () => {
    const f = {
      preferences: [three, { words: ["laptop", "phone"], he: "לטלפון ולמחשב נייד" }],
    };
    expect(preferenceFit("Sonic Number 3 Balloon", f)).toBe(0.5);
    expect(preferenceFit("Sonic Number 3 Balloon for Phone and Laptop", f)).toBe(1);
    expect(preferenceFit("Sonic Balloon for Phone", f)).toBe(0);
    expect(preferenceFit("Sonic Balloon", { preferences: [] })).toBe(0);
    expect(preferenceFit("Sonic Balloon", {})).toBe(0);
  });
});
