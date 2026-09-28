import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/config/brand";
import {
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_IDLE,
  NEWSLETTER_MESSAGES,
  newsletterState,
} from "./consent";
import { newsletterEmailSchema, parseSignupForm } from "./schema";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const ok = { email: "Dana@Example.com", consent: "yes", source: "footer" };

describe("the consent text", () => {
  it("is the owner's wording, naming the brand", () => {
    expect(BRAND.name).toBe("מצאתי");
    expect(NEWSLETTER_CONSENT_TEXT).toBe(
      "אני מסכים/ה לקבל מ״מצאתי״ עדכונים על מבצעים וקופונים באימייל. אפשר להסיר את ההרשמה בכל עת.",
    );
  });

  it("has a version the migration accepts", () => {
    expect(NEWSLETTER_CONSENT_VERSION).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
  });

  it("promises no frequency in any message", () => {
    for (const text of [NEWSLETTER_CONSENT_TEXT, ...Object.values(NEWSLETTER_MESSAGES)]) {
      expect(text).not.toMatch(/פעם ב|כל יום|כל שבוע|שבועי|יומי|חודשי/);
    }
  });
});

describe("newsletterEmailSchema", () => {
  it("trims and lowercases", () => {
    expect(newsletterEmailSchema.parse("  Dana.Levi+Deals@Example.CO.IL ")).toBe(
      "dana.levi+deals@example.co.il",
    );
  });

  it.each([
    "",
    "dana",
    "dana@",
    "@example.com",
    "dana@example",
    "dana@@example.com",
    "da na@example.com",
    ".dana@example.com",
    "dana..levi@example.com",
    "dana@example.c",
  ])("rejects %j", (value) => {
    expect(newsletterEmailSchema.safeParse(value).success).toBe(false);
  });

  it.each(["-dana@example.com", "+972@example.com", "'dana@example.com"])(
    "rejects %j, which starts with a symbol (a spreadsheet formula)",
    (value) => {
      expect(newsletterEmailSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects an address over 254 characters or a local part over 64", () => {
    const label = (c: string) => c.repeat(61);
    const domain = `${label("a")}.${label("b")}.${label("c")}.${label("d")}.com`; // 251
    expect(`x@${domain}`).toHaveLength(253);
    expect(newsletterEmailSchema.safeParse(`x@${domain}`).success).toBe(true);
    expect(newsletterEmailSchema.safeParse(`xyz@${domain}`).success).toBe(false); // 255
    expect(newsletterEmailSchema.safeParse(`${"a".repeat(65)}@example.com`).success).toBe(false);
    expect(newsletterEmailSchema.safeParse(`${"a".repeat(64)}@example.com`).success).toBe(true);
  });
});

describe("parseSignupForm", () => {
  it("accepts a valid address with consent", () => {
    expect(parseSignupForm(form(ok))).toEqual({
      kind: "ok",
      email: "dana@example.com",
      source: "footer",
    });
  });

  it("falls back to the footer for a missing or unknown source", () => {
    const noSource = { email: ok.email, consent: ok.consent };
    expect(parseSignupForm(form(noSource))).toMatchObject({ kind: "ok", source: "footer" });
    expect(parseSignupForm(form({ ...ok, source: "admin" }))).toMatchObject({
      kind: "ok",
      source: "footer",
    });
  });

  it("rejects an invalid address first, keeping what was typed", () => {
    expect(parseSignupForm(form({ email: "  dana@ ", consent: "" }))).toEqual({
      kind: "invalid",
      status: "invalid_email",
      email: "dana@",
      consent: false,
    });
  });

  it("requires the consent box, checked with its own value", () => {
    for (const consent of [undefined, "", "no", "on", "true"]) {
      const fields: Record<string, string> = { email: ok.email };
      if (consent !== undefined) fields.consent = consent;
      expect(parseSignupForm(form(fields))).toEqual({
        kind: "invalid",
        status: "consent_required",
        email: ok.email,
        consent: false,
      });
    }
  });

  it("treats a filled honeypot as a bot, whatever else was sent", () => {
    expect(parseSignupForm(form({ ...ok, website: "https://spam.example" }))).toEqual({
      kind: "bot",
    });
    expect(parseSignupForm(form({ email: "junk", website: "x" }))).toEqual({ kind: "bot" });
    // Spaces only: not filled.
    expect(parseSignupForm(form({ ...ok, website: "   " }))).toMatchObject({ kind: "ok" });
  });

  it("ignores a non-text email field", () => {
    const data = form({ consent: "yes" });
    data.set("email", new Blob(["dana@example.com"]));
    expect(parseSignupForm(data)).toMatchObject({ kind: "invalid", status: "invalid_email" });
  });
});

describe("newsletterState", () => {
  it("clears the fields on success and keeps them on an error", () => {
    expect(newsletterState("idle")).toBe(NEWSLETTER_IDLE);
    expect(newsletterState("subscribed", { email: "a@b.co", consent: true })).toEqual({
      status: "subscribed",
      message: NEWSLETTER_MESSAGES.subscribed,
      email: "",
      consent: false,
    });
    expect(newsletterState("rate_limited", { email: "a@b.co", consent: true })).toEqual({
      status: "rate_limited",
      message: NEWSLETTER_MESSAGES.rate_limited,
      email: "a@b.co",
      consent: true,
    });
  });

  it("says the visitor will get updates on deals and coupons", () => {
    expect(NEWSLETTER_MESSAGES.subscribed).toContain("מבצעים וקופונים");
  });
});
