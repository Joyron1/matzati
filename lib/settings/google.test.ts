// The "חיבור לגוגל" extraction: whatever the owner pastes, only a valid GA4 measurement id and a
// valid Search Console token come out, and nothing else of the pasted text.
import { describe, expect, it } from "vitest";
import {
  EXTRACT_ERRORS,
  extractMeasurementId,
  extractVerificationToken,
  GA_FIELD,
  GA4_ID_PATTERN,
  GOOGLE_FIELD_MAX,
  googleSettingsInputSchema,
  GSC_FIELD,
  GSC_TOKEN_PATTERN,
  measurementIdOf,
  parseGoogleForm,
  siteVerificationOf,
} from "./google";

// Google's gtag.js snippet as the GA4 "install manually" page gives it.
const GTAG_SNIPPET = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-AB12CD34EF');
</script>`;

const TOKEN = "rXkTz3m9_Q-abcdEFGHijklMNOP0123456789xyzAB";
const META = `<meta name="google-site-verification" content="${TOKEN}" />`;

describe("extractMeasurementId", () => {
  it("finds the id in Google's whole snippet (named twice) and alone", () => {
    expect(extractMeasurementId(GTAG_SNIPPET)).toEqual({ kind: "found", value: "G-AB12CD34EF" });
    expect(extractMeasurementId("G-AB12CD34EF")).toEqual({ kind: "found", value: "G-AB12CD34EF" });
    expect(extractMeasurementId("  G-AB12CD34EF\n")).toEqual({
      kind: "found",
      value: "G-AB12CD34EF",
    });
  });

  it("upper-cases a typed id and accepts the gtag URL or config line alone", () => {
    expect(extractMeasurementId("g-ab12cd34ef")).toEqual({ kind: "found", value: "G-AB12CD34EF" });
    expect(extractMeasurementId("https://www.googletagmanager.com/gtag/js?id=G-XYZ9876")).toEqual({
      kind: "found",
      value: "G-XYZ9876",
    });
    expect(extractMeasurementId("gtag('config', 'G-XYZ9876');")).toEqual({
      kind: "found",
      value: "G-XYZ9876",
    });
  });

  it("is empty for an empty field (the connection is removed)", () => {
    expect(extractMeasurementId("")).toEqual({ kind: "empty" });
    expect(extractMeasurementId("   \n ")).toEqual({ kind: "empty" });
  });

  it("refuses two different ids, and says which", () => {
    const result = extractMeasurementId(`${GTAG_SNIPPET}\ngtag('config', 'G-OTHER99');`);
    expect(result).toEqual({
      kind: "error",
      message: EXTRACT_ERRORS.gaMany(["G-AB12CD34EF", "G-OTHER99"]),
    });
  });

  it("names Universal Analytics and Tag Manager ids instead of taking them", () => {
    expect(extractMeasurementId("UA-12345678-1")).toEqual({
      kind: "error",
      message: EXTRACT_ERRORS.gaUniversal,
    });
    expect(
      extractMeasurementId(
        "<script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-ABC123');</script>",
      ),
    ).toEqual({ kind: "error", message: EXTRACT_ERRORS.gaTagManager });
  });

  it("takes nothing that is not a whole id", () => {
    for (const text of [
      "hello",
      "G-ABC", // too short
      "G-ABCDEFGHIJKLM", // 13 characters: too long
      "XG-ABCD1234", // inside a longer word
      "G-ABCD_1234",
      "GT-ABCD1234", // a Google tag id, not a measurement id
      "long-term plan",
    ]) {
      expect(extractMeasurementId(text).kind, text).toBe("error");
    }
    expect(extractMeasurementId("G-".padEnd(GOOGLE_FIELD_MAX + 1, "A"))).toEqual({
      kind: "error",
      message: EXTRACT_ERRORS.tooLong,
    });
  });

  it("only ever gives values the stored schema accepts", () => {
    for (const text of [GTAG_SNIPPET, "g-abcd", "G-A1B2C3D4E5F6"]) {
      const result = extractMeasurementId(text);
      expect(result.kind).toBe("found");
      if (result.kind === "found") expect(result.value).toMatch(GA4_ID_PATTERN);
    }
  });
});

describe("extractVerificationToken", () => {
  it("takes the content of Google's meta tag, quoted either way or not at all", () => {
    expect(extractVerificationToken(META)).toEqual({ kind: "found", value: TOKEN });
    expect(
      extractVerificationToken(`<meta content='${TOKEN}' name='google-site-verification'>`),
    ).toEqual({
      kind: "found",
      value: TOKEN,
    });
    expect(
      extractVerificationToken(`<META NAME=google-site-verification CONTENT=${TOKEN}>`),
    ).toEqual({ kind: "found", value: TOKEN });
    // Pasted with the text around it on the Search Console page.
    expect(extractVerificationToken(`Copy the meta tag below:\n${META}\n`)).toEqual({
      kind: "found",
      value: TOKEN,
    });
  });

  it("takes the content value alone, with or without its quotes", () => {
    expect(extractVerificationToken(TOKEN)).toEqual({ kind: "found", value: TOKEN });
    expect(extractVerificationToken(`"${TOKEN}"`)).toEqual({ kind: "found", value: TOKEN });
  });

  it("is empty for an empty field", () => {
    expect(extractVerificationToken(" ")).toEqual({ kind: "empty" });
  });

  it("refuses another meta tag, two different tokens, and the other verification methods", () => {
    expect(extractVerificationToken('<meta name="description" content="abc">')).toEqual({
      kind: "error",
      message: EXTRACT_ERRORS.gscOtherTag,
    });
    expect(
      extractVerificationToken(
        `${META}<meta name="google-site-verification" content="${TOKEN.replace("r", "s")}">`,
      ),
    ).toEqual({ kind: "error", message: EXTRACT_ERRORS.gscMany });
    expect(extractVerificationToken("google1234567890abcdef.html")).toEqual({
      kind: "error",
      message: EXTRACT_ERRORS.gscHtmlFile,
    });
    expect(extractVerificationToken(`google-site-verification=${TOKEN}`)).toEqual({
      kind: "error",
      message: EXTRACT_ERRORS.gscDns,
    });
  });

  it("refuses a token with characters or a length Google does not use", () => {
    for (const text of [
      "short",
      "abc def ghi jkl mno pqr stu",
      `<meta name="google-site-verification" content="${TOKEN}<script>">`,
      '<meta name="google-site-verification" content="&quot;><script>alert(1)</script>">',
      "x".repeat(101),
    ]) {
      expect(extractVerificationToken(text).kind, text).toBe("error");
    }
  });

  it("only ever gives values the stored schema accepts", () => {
    const result = extractVerificationToken(META);
    expect(result.kind === "found" && GSC_TOKEN_PATTERN.test(result.value)).toBe(true);
  });
});

describe("stored values", () => {
  it("reads a valid id or token, and null for a cleared, missing or hand-edited one", () => {
    expect(measurementIdOf({ measurementId: "G-AB12CD34EF" })).toBe("G-AB12CD34EF");
    expect(measurementIdOf({ measurementId: null })).toBeNull();
    expect(measurementIdOf({ measurementId: "<script>" })).toBeNull();
    expect(measurementIdOf(undefined)).toBeNull();
    expect(siteVerificationOf({ verification: TOKEN })).toBe(TOKEN);
    expect(siteVerificationOf({ verification: '"><script>' })).toBeNull();
    expect(siteVerificationOf("abc")).toBeNull();
  });

  it("the save schema takes only extracted values", () => {
    expect(
      googleSettingsInputSchema.safeParse({ measurementId: null, siteVerification: null }).success,
    ).toBe(true);
    expect(
      googleSettingsInputSchema.safeParse({ measurementId: GTAG_SNIPPET, siteVerification: null })
        .success,
    ).toBe(false);
    expect(
      googleSettingsInputSchema.safeParse({ measurementId: null, siteVerification: META }).success,
    ).toBe(false);
  });
});

describe("parseGoogleForm", () => {
  const form = (ga: string, gsc: string) => {
    const f = new FormData();
    f.set(GA_FIELD, ga);
    f.set(GSC_FIELD, gsc);
    return f;
  };

  it("gives the extracted values to store; an empty field clears", () => {
    expect(parseGoogleForm(form(GTAG_SNIPPET, META))).toEqual({
      ok: true,
      value: { measurementId: "G-AB12CD34EF", siteVerification: TOKEN },
    });
    expect(parseGoogleForm(form("", ""))).toEqual({
      ok: true,
      value: { measurementId: null, siteVerification: null },
    });
    expect(parseGoogleForm(new FormData())).toEqual({
      ok: true,
      value: { measurementId: null, siteVerification: null },
    });
  });

  it("returns what was typed with a message per field, and stores nothing", () => {
    expect(parseGoogleForm(form("UA-12345678-1", META))).toEqual({
      ok: false,
      state: {
        values: { ga: "UA-12345678-1", gsc: META },
        errors: { ga: EXTRACT_ERRORS.gaUniversal },
      },
    });
    const both = parseGoogleForm(form("nope", "nope"));
    expect(both.ok).toBe(false);
    if (!both.ok) expect(Object.keys(both.state.errors).sort()).toEqual(["ga", "gsc"]);
  });
});
