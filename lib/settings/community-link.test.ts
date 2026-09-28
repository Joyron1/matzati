// The community link: https only, a clean label with a default, shown only when switched on.
import { describe, expect, it } from "vitest";
import {
  checkCommunityUrl,
  COMMUNITY_ENABLED_FIELD,
  COMMUNITY_ERRORS,
  COMMUNITY_LABEL_FIELD,
  COMMUNITY_LABEL_MAX,
  COMMUNITY_URL_FIELD,
  communityLinkOf,
  communityValueOf,
  communityValueSchema,
  DEFAULT_COMMUNITY_LABEL,
  DEFAULT_COMMUNITY_VALUE,
  normalizeCommunityLabel,
  parseCommunityForm,
} from "./community-link";

const INVITE = "https://chat.whatsapp.com/AbCdEf123";

describe("checkCommunityUrl", () => {
  it("takes an https link, normalized, and an empty field as no link", () => {
    expect(checkCommunityUrl(INVITE)).toEqual({ ok: true, url: INVITE });
    expect(checkCommunityUrl(`  ${INVITE} `)).toEqual({ ok: true, url: INVITE });
    expect(checkCommunityUrl("https://t.me")).toEqual({ ok: true, url: "https://t.me/" });
    expect(checkCommunityUrl("")).toEqual({ ok: true, url: null });
  });

  it("refuses anything but https, with the reason", () => {
    const refused = (text: string) => {
      const check = checkCommunityUrl(text);
      return check.ok ? null : check.message;
    };
    expect(refused("http://chat.whatsapp.com/x")).toBe(COMMUNITY_ERRORS.urlNotHttps);
    expect(refused("chat.whatsapp.com/x")).toBe(COMMUNITY_ERRORS.urlNotHttps);
    expect(refused("javascript:alert(1)")).toBe(COMMUNITY_ERRORS.urlNotHttps);
    expect(refused("data:text/html,<script>alert(1)</script>")).toBe(COMMUNITY_ERRORS.urlNotHttps);
    expect(refused("https://user:pass@example.com/")).toBe(COMMUNITY_ERRORS.urlCredentials);
    expect(refused("https://localhost/x")).toBe(COMMUNITY_ERRORS.urlInvalid);
    expect(refused("https://exa mple.com")).toBe(COMMUNITY_ERRORS.urlInvalid);
    expect(refused(`https://example.com/${"a".repeat(600)}`)).toBe(COMMUNITY_ERRORS.urlTooLong);
  });
});

describe("normalizeCommunityLabel", () => {
  it("collapses spaces and removes control and direction-override characters", () => {
    expect(normalizeCommunityLabel("  הצטרפו   לקהילה \n")).toBe("הצטרפו לקהילה");
    const rlo = String.fromCharCode(0x202e); // right-to-left override
    const isolate = String.fromCharCode(0x2067);
    const bell = String.fromCharCode(7);
    expect(normalizeCommunityLabel(`קהילה${rlo}טובה${bell}${isolate}`)).toBe("קהילהטובה");
  });
});

describe("stored value", () => {
  it("shows the button only when switched on with a link", () => {
    expect(communityLinkOf({ url: INVITE, label: "בואו", enabled: true })).toEqual({
      url: INVITE,
      label: "בואו",
    });
    expect(communityLinkOf({ url: INVITE, label: "בואו", enabled: false })).toBeNull();
    expect(communityLinkOf(DEFAULT_COMMUNITY_VALUE)).toBeNull();
    expect(communityLinkOf(undefined)).toBeNull();
  });

  it("reads a hand-edited row that breaks a rule as no setting", () => {
    for (const value of [
      { url: "http://example.com/", label: "בואו", enabled: true },
      { url: "javascript:alert(1)", label: "בואו", enabled: true },
      { url: null, label: "בואו", enabled: true }, // shown without a link
      { url: INVITE, label: "x".repeat(COMMUNITY_LABEL_MAX + 1), enabled: true },
      { url: INVITE, label: " רווח ", enabled: true }, // not normalized
      { url: INVITE, label: "בואו", enabled: "yes" },
    ]) {
      expect(communityValueOf(value), JSON.stringify(value)).toBeNull();
      expect(communityLinkOf(value)).toBeNull();
    }
    expect(communityValueSchema.safeParse(DEFAULT_COMMUNITY_VALUE).success).toBe(true);
  });
});

describe("parseCommunityForm", () => {
  const form = (url: string, label: string, enabled: boolean) => {
    const f = new FormData();
    f.set(COMMUNITY_URL_FIELD, url);
    f.set(COMMUNITY_LABEL_FIELD, label);
    if (enabled) f.set(COMMUNITY_ENABLED_FIELD, "on");
    return f;
  };

  it("gives the value to store, with the default label for an empty one", () => {
    expect(parseCommunityForm(form(INVITE, "", true))).toEqual({
      ok: true,
      value: { url: INVITE, label: DEFAULT_COMMUNITY_LABEL, enabled: true },
    });
    expect(parseCommunityForm(form("", " קבוצת הדילים ", false))).toEqual({
      ok: true,
      value: { url: null, label: "קבוצת הדילים", enabled: false },
    });
  });

  it("needs a link to show the button, and a label that fits", () => {
    expect(parseCommunityForm(form("", "", true))).toEqual({
      ok: false,
      state: {
        values: { url: "", label: "", enabled: true },
        errors: { url: COMMUNITY_ERRORS.urlRequired },
      },
    });
    const long = parseCommunityForm(form(INVITE, "א".repeat(COMMUNITY_LABEL_MAX + 1), false));
    expect(long.ok ? null : long.state.errors).toEqual({ label: COMMUNITY_ERRORS.labelLong });
    const short = parseCommunityForm(form(INVITE, "א", false));
    expect(short.ok ? null : short.state.errors).toEqual({ label: COMMUNITY_ERRORS.labelShort });
    const http = parseCommunityForm(form("http://t.me/x", "", false));
    expect(http.ok ? null : http.state.errors).toEqual({ url: COMMUNITY_ERRORS.urlNotHttps });
  });

  it("every value it gives passes the stored schema", () => {
    for (const f of [
      form(INVITE, "", true),
      form("", "", false),
      form("https://t.me", "x y", true),
    ]) {
      const parsed = parseCommunityForm(f);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(communityValueSchema.safeParse(parsed.value).success).toBe(true);
    }
  });
});
