import { describe, expect, it } from "vitest";
import {
  ACCEPT_ALL,
  ANALYTICS_NOTICE,
  BASE_NOTICE,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_DAYS,
  CONSENT_VERSION,
  NECESSARY_ONLY,
  consentAllows,
  consentCookie,
  consentFromCookies,
  consentNotice,
  makeConsent,
  parseConsent,
  readCookie,
  type ConsentState,
} from "./consent";
import {
  analyticsStorage,
  CONSENT_CATEGORIES,
  consentCategories,
  STORAGE_INVENTORY,
  storageInventory,
} from "./categories";
import { MY_SEARCHES_KEY, MY_SEARCHES_MAX } from "@/lib/recent/mine";

const NOW = Date.UTC(2026, 8, 28, 12);
const DAY = 86_400_000;

const stored = (over: Partial<Record<keyof ConsentState, unknown>> = {}) =>
  encodeURIComponent(
    JSON.stringify({
      v: CONSENT_VERSION,
      necessary: true,
      analytics: false,
      marketing: false,
      ts: NOW - DAY,
      ...over,
    }),
  );

describe("parseConsent", () => {
  it("reads a stored choice", () => {
    expect(parseConsent(stored({ analytics: true }), NOW)).toEqual({
      v: CONSENT_VERSION,
      necessary: true,
      analytics: true,
      marketing: false,
      ts: NOW - DAY,
    });
  });

  it("accepts a value that was not URI-encoded", () => {
    const raw = JSON.stringify({
      v: 1,
      necessary: true,
      analytics: false,
      marketing: true,
      ts: NOW,
    });
    expect(parseConsent(raw, NOW, 1)?.marketing).toBe(true);
  });

  it("drops keys it does not know", () => {
    expect(parseConsent(stored({ extra: "x" } as never), NOW)).not.toHaveProperty("extra");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not JSON", "yes"],
    ["broken encoding", "%E0%A4%A"],
    ["an array", encodeURIComponent("[1]")],
    ["null", encodeURIComponent("null")],
  ])("asks again when the value is %s", (_, value) => {
    expect(parseConsent(value, NOW)).toBeNull();
  });

  it.each([
    ["necessary is off", { necessary: false }],
    ["a category is not a boolean", { analytics: "true" }],
    ["a category is missing", { marketing: undefined }],
    ["the time is missing", { ts: undefined }],
    ["the time is not a number", { ts: "2026-09-28" }],
    ["the version is missing", { v: undefined }],
  ])("asks again when %s", (_, over) => {
    expect(parseConsent(stored(over), NOW)).toBeNull();
  });

  it("asks again after CONSENT_MAX_AGE_DAYS, not before", () => {
    const limit = NOW - CONSENT_MAX_AGE_DAYS * DAY;
    expect(parseConsent(stored({ ts: limit }), NOW)).not.toBeNull();
    expect(parseConsent(stored({ ts: limit - 1 }), NOW)).toBeNull();
  });

  it("tolerates a small clock difference but not a choice dated in the future", () => {
    expect(parseConsent(stored({ ts: NOW + DAY / 2 }), NOW)).not.toBeNull();
    expect(parseConsent(stored({ ts: NOW + 2 * DAY }), NOW)).toBeNull();
  });
});

describe("policy versioning", () => {
  it("honors only the current version", () => {
    expect(parseConsent(stored({ v: CONSENT_VERSION }), NOW)).not.toBeNull();
    expect(parseConsent(stored({ v: CONSENT_VERSION - 1 }), NOW)).toBeNull();
    expect(parseConsent(stored({ v: CONSENT_VERSION + 1 }), NOW)).toBeNull();
  });

  it("re-asks everyone once the version is bumped", () => {
    const today = consentCookie(makeConsent(ACCEPT_ALL, NOW), { secure: true });
    const value = readCookie(today.split(";")[0], CONSENT_COOKIE);
    expect(parseConsent(value, NOW)).not.toBeNull();
    expect(parseConsent(value, NOW, CONSENT_VERSION + 1)).toBeNull();
  });

  it("stamps a new choice with the current version", () => {
    expect(makeConsent(NECESSARY_ONLY, NOW).v).toBe(CONSENT_VERSION);
  });
});

describe("the notice while Google Analytics is configured", () => {
  const choiceUnder = (version: number) =>
    readCookie(
      consentCookie(makeConsent(ACCEPT_ALL, NOW, version), { secure: true }).split(";")[0],
      CONSENT_COOKIE,
    );

  it("asks everyone again: a choice made before it (statistics said unused) does not count", () => {
    expect(consentNotice(true)).toBe(ANALYTICS_NOTICE);
    expect(consentNotice(false)).toBe(BASE_NOTICE);
    expect(ANALYTICS_NOTICE.version).not.toBe(CONSENT_VERSION);
    expect(parseConsent(choiceUnder(BASE_NOTICE.version), NOW, ANALYTICS_NOTICE)).toBeNull();
    const cookies = `${CONSENT_COOKIE}=${choiceUnder(BASE_NOTICE.version)}`;
    expect(consentFromCookies(cookies, NOW, ANALYTICS_NOTICE)).toBeNull();
  });

  it("honors a choice made under it", () => {
    const state = parseConsent(choiceUnder(ANALYTICS_NOTICE.version), NOW, ANALYTICS_NOTICE);
    expect(state?.analytics).toBe(true);
    expect(consentAllows(state, "analytics")).toBe(true);
  });

  it("without it, a choice made under it still counts (a failed settings read asks no one again)", () => {
    expect(parseConsent(choiceUnder(ANALYTICS_NOTICE.version), NOW, BASE_NOTICE)).not.toBeNull();
    expect(parseConsent(choiceUnder(ANALYTICS_NOTICE.version), NOW)).not.toBeNull();
  });
});

describe("readCookie and consentFromCookies", () => {
  it("finds the cookie among others, by its exact name", () => {
    const cookies = `a=1; x${CONSENT_COOKIE}=nope; ${CONSENT_COOKIE}=${stored()}; b=2`;
    expect(readCookie(cookies, CONSENT_COOKIE)).toBe(stored());
    expect(consentFromCookies(cookies, NOW)?.analytics).toBe(false);
  });

  it("returns nothing when the cookie is absent", () => {
    expect(readCookie("", CONSENT_COOKIE)).toBeUndefined();
    expect(consentFromCookies("theme=dark; other", NOW)).toBeNull();
  });
});

describe("consentCookie", () => {
  it("stores the choice for 12 months on the whole site, SameSite=Lax", () => {
    const cookie = consentCookie(makeConsent(NECESSARY_ONLY, NOW), { secure: false });
    expect(cookie).toMatch(new RegExp(`^${CONSENT_COOKIE}=[^;\\s]+; `));
    expect(cookie).toContain(`; Max-Age=${365 * 24 * 60 * 60}`);
    expect(cookie).toContain("; Path=/");
    expect(cookie).toContain("; SameSite=Lax");
    expect(cookie).not.toContain("Secure");
    expect(cookie).not.toContain("Domain");
  });

  it("adds Secure on https", () => {
    expect(consentCookie(makeConsent(NECESSARY_ONLY, NOW), { secure: true })).toMatch(/; Secure$/);
  });

  it("round-trips through the parser", () => {
    const state = makeConsent({ analytics: true, marketing: false }, NOW);
    const value = readCookie(consentCookie(state, { secure: true }), CONSENT_COOKIE);
    expect(value).not.toMatch(/[\s",;]/); // a valid cookie-octet string
    expect(parseConsent(value, NOW)).toEqual(state);
  });
});

describe("consentAllows", () => {
  const all = makeConsent(ACCEPT_ALL, NOW);
  const none = makeConsent(NECESSARY_ONLY, NOW);

  it("always allows necessary storage", () => {
    for (const consent of [undefined, null, none, all]) {
      expect(consentAllows(consent, "necessary")).toBe(true);
    }
  });

  it("keeps optional categories off while unknown or not chosen", () => {
    for (const consent of [undefined, null, none]) {
      expect(consentAllows(consent, "analytics")).toBe(false);
      expect(consentAllows(consent, "marketing")).toBe(false);
    }
  });

  it("allows exactly the categories the visitor accepted", () => {
    const analyticsOnly = makeConsent({ analytics: true, marketing: false }, NOW);
    expect(consentAllows(analyticsOnly, "analytics")).toBe(true);
    expect(consentAllows(analyticsOnly, "marketing")).toBe(false);
    expect(consentAllows(all, "marketing")).toBe(true);
  });
});

describe("what the notice says", () => {
  it("names every category once, with necessary first and always in use", () => {
    expect(CONSENT_CATEGORIES.map((c) => c.id)).toEqual(["necessary", "analytics", "marketing"]);
    expect(CONSENT_CATEGORIES[0].inUse).toBe(true);
  });

  it("marks a category in use only when some stored item belongs to it, with or without GA", () => {
    for (const measurementId of [null, "G-AB12CD34EF"]) {
      const inventory = storageInventory(measurementId);
      for (const category of consentCategories(measurementId !== null)) {
        const used = inventory.some((item) => item.category === category.id);
        expect(category.inUse, `${category.id} ${measurementId}`).toBe(used);
      }
    }
    expect(consentCategories(false)).toBe(CONSENT_CATEGORIES);
    expect(storageInventory(null)).toBe(STORAGE_INVENTORY);
  });

  it("lists the consent cookie itself", () => {
    expect(STORAGE_INVENTORY.map((item) => item.name)).toContain(CONSENT_COOKIE);
  });

  it("lists the visitor's own searches as necessary storage that stays in the browser", () => {
    const item = STORAGE_INVENTORY.find((i) => i.name === MY_SEARCHES_KEY);
    expect(item).toMatchObject({ kind: "localStorage", category: "necessary" });
    expect(item?.provider).toBeUndefined();
    expect(item?.purpose).toContain(String(MY_SEARCHES_MAX));
    expect(CONSENT_CATEGORIES.find((c) => c.id === "necessary")?.description).toContain(
      "החיפושים האחרונים שלכם",
    );
  });

  it("lists Google Analytics's cookies as statistics from Google, for 2 years", () => {
    const items = analyticsStorage("G-AB12CD34EF");
    expect(items.map((item) => item.name)).toEqual(["_ga", "_ga_AB12CD34EF"]);
    for (const item of items) {
      expect(item).toMatchObject({ kind: "cookie", category: "analytics" });
      expect(item.provider).toContain("Google");
      expect(item.duration).toContain("שנתיים");
    }
    expect(consentCategories(true).find((c) => c.id === "analytics")?.description).toContain(
      "Google Analytics",
    );
    expect(consentCategories(true).find((c) => c.id === "marketing")?.inUse).toBe(false);
  });
});
