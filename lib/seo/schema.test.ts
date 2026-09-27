import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import type { SeoPage } from "./db";
import {
  INTRO_MAX,
  parseSeoForm,
  QUERY_MAX,
  readSeoFormValues,
  SEO_ERRORS,
  seoFormValues,
  TITLE_MAX,
  validateSeoInput,
  type SeoFormValues,
} from "./schema";

const form = (overrides: Partial<SeoFormValues> = {}): SeoFormValues => ({
  query: "אוזניות לריצה עמידות למים",
  title_he: "אוזניות לריצה עמידות למים",
  intro_he: "",
  slug: "",
  published: false,
  ...overrides,
});

describe("parseSeoForm", () => {
  it("builds the slug from the query when the field is empty", () => {
    const result = parseSeoForm(form());
    expect(result).toEqual({
      ok: true,
      input: {
        slug: "אוזניות-לריצה-עמידות-למים",
        query: "אוזניות לריצה עמידות למים",
        title_he: "אוזניות לריצה עמידות למים",
        intro_he: null,
        published: false,
      },
    });
  });

  it("keeps a typed slug after light normalization", () => {
    const result = parseSeoForm(form({ slug: " אוזניות ריצה " }));
    expect(result.ok && result.input.slug).toBe("אוזניות-ריצה");
  });

  it("reports a typed slug with characters we do not allow", () => {
    const result = parseSeoForm(form({ slug: "אוזניות/ריצה" }));
    expect(result).toEqual({ ok: false, errors: { slug: SEO_ERRORS.slug } });
  });

  it("says so when no slug can be built from the query", () => {
    const result = parseSeoForm(form({ query: "🌙✨" }));
    expect(result).toEqual({ ok: false, errors: { slug: SEO_ERRORS.slugFromQuery } });
  });

  it("reports only the missing query when the slug was left to be built from it", () => {
    const result = parseSeoForm(form({ query: "  " }));
    expect(result).toEqual({ ok: false, errors: { query: SEO_ERRORS.query } });
  });

  it("trims text and turns an empty intro into null", () => {
    const result = parseSeoForm(
      form({ query: "  מנורת לילה  ", title_he: "  מנורות לילה לחדר ילדים ", intro_he: "   " }),
    );
    expect(result.ok && result.input).toMatchObject({
      query: "מנורת לילה",
      title_he: "מנורות לילה לחדר ילדים",
      intro_he: null,
    });
  });

  it("reports every invalid field at once", () => {
    const result = parseSeoForm(
      form({ query: " ", title_he: "א", intro_he: "א".repeat(INTRO_MAX + 1), slug: "x" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      query: SEO_ERRORS.query,
      title_he: SEO_ERRORS.title,
      intro_he: SEO_ERRORS.intro,
    });
  });

  it("enforces the length limits", () => {
    expect(parseSeoForm(form({ query: "א".repeat(QUERY_MAX + 1) })).ok).toBe(false);
    expect(parseSeoForm(form({ title_he: "א".repeat(TITLE_MAX + 1) })).ok).toBe(false);
    expect(parseSeoForm(form({ title_he: "א".repeat(TITLE_MAX) })).ok).toBe(true);
  });
});

describe("validateSeoInput", () => {
  it("rejects a slug that is not normalized (the last check before a write)", () => {
    const result = validateSeoInput({
      slug: "Bad Slug",
      query: "q",
      title_he: "כותרת",
      intro_he: null,
      published: true,
    });
    expect(result).toEqual({ ok: false, errors: { slug: SEO_ERRORS.slug } });
  });

  it("rejects a non-boolean published flag", () => {
    const result = validateSeoInput({
      slug: "abc",
      query: "q",
      title_he: "כותרת",
      intro_he: null,
      published: "yes",
    });
    expect(result.ok).toBe(false);
  });
});

describe("form values", () => {
  it("reads the form data, with the checkbox as a boolean", () => {
    const fd = new FormData();
    fd.set("query", "q");
    fd.set("title_he", "t");
    fd.set("slug", "s");
    fd.set("published", "on");
    expect(readSeoFormValues(fd)).toEqual({
      query: "q",
      title_he: "t",
      intro_he: "",
      slug: "s",
      published: true,
    });
    expect(readSeoFormValues(new FormData()).published).toBe(false);
  });

  it("prefills a new page from ?q= as a draft", () => {
    expect(seoFormValues(null, "  מחזיק טלפון לרכב ")).toEqual({
      query: "מחזיק טלפון לרכב",
      title_he: "מחזיק טלפון לרכב",
      intro_he: "",
      slug: "מחזיק-טלפון-לרכב",
      published: false,
    });
    expect(seoFormValues(null)).toEqual({
      query: "",
      title_he: "",
      intro_he: "",
      slug: "",
      published: false,
    });
  });

  it("caps an overlong ?q= at the query limit", () => {
    const values = seoFormValues(null, "א".repeat(500));
    expect(values.query).toHaveLength(QUERY_MAX);
    expect(values.title_he).toHaveLength(TITLE_MAX);
  });

  it("loads an existing page", () => {
    const page: SeoPage = {
      slug: "abc",
      query: "q",
      title_he: "כותרת",
      intro_he: null,
      published: true,
      created_at: "2026-09-27T10:00:00.000Z",
      updated_at: "2026-09-27T10:00:00.000Z",
    };
    expect(seoFormValues(page)).toEqual({
      query: "q",
      title_he: "כותרת",
      intro_he: "",
      slug: "abc",
      published: true,
    });
  });

  it("uses the same query limit as the search pipeline", () => {
    expect(QUERY_MAX).toBe(MAX_QUERY_LENGTH);
  });
});
