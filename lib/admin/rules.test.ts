import { describe, expect, it } from "vitest";
import { adminEmails } from "@/lib/env";
import {
  ADMIN_LOGIN_PATH,
  adminFromUser,
  authCallbackUrl,
  authCookieOptions,
  exchangeErrorFor,
  FALLBACK_ORIGIN,
  isAllowedAdmin,
  isSupabaseAuthCookie,
  LOGIN_ERROR_MESSAGES,
  LOGIN_ERRORS,
  LOGIN_MESSAGES,
  LOGIN_MIN_RESPONSE_MS,
  linkErrorFromQuery,
  loginErrorFromParam,
  loginErrorPath,
  loginState,
  newPasswordError,
  normalizeEmail,
  paddingMs,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  requestOrigin,
} from "./rules";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const allowed = adminEmails(
  env({ ADMIN_EMAILS: " Owner@Example.com, second@example.co.il ,not-an-email" }),
);
const confirmed = "2026-09-27T10:00:00Z";

describe("normalizeEmail", () => {
  it("trims and lowercases a valid address", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("rejects invalid, empty, oversized and non-string values", () => {
    expect(normalizeEmail("owner")).toBeNull();
    expect(normalizeEmail("owner@")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(new Blob(["x"]))).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("admin allow-list", () => {
  it("matches ADMIN_EMAILS case-insensitively", () => {
    expect(allowed).toEqual(["owner@example.com", "second@example.co.il"]);
    expect(isAllowedAdmin("OWNER@example.com", allowed)).toBe(true);
    expect(isAllowedAdmin(" second@example.co.il ", allowed)).toBe(true);
  });

  it("refuses other, partial and empty addresses", () => {
    expect(isAllowedAdmin("owner@example.com.evil.io", allowed)).toBe(false);
    expect(isAllowedAdmin("wner@example.com", allowed)).toBe(false);
    expect(isAllowedAdmin("", allowed)).toBe(false);
    expect(isAllowedAdmin(null, allowed)).toBe(false);
    expect(isAllowedAdmin(undefined, allowed)).toBe(false);
  });

  it("allows nobody when ADMIN_EMAILS is empty", () => {
    expect(isAllowedAdmin("owner@example.com", adminEmails(env({})))).toBe(false);
    expect(isAllowedAdmin("owner@example.com", adminEmails(env({ ADMIN_EMAILS: " , " })))).toBe(
      false,
    );
  });
});

describe("adminFromUser", () => {
  it("returns the lowercased email of a confirmed admin", () => {
    const user = { email: "Owner@Example.com", email_confirmed_at: confirmed };
    expect(adminFromUser(user, allowed)).toEqual({ email: "owner@example.com" });
  });

  it("refuses unconfirmed emails, non-admins and missing users", () => {
    expect(adminFromUser({ email: "owner@example.com" }, allowed)).toBeNull();
    expect(adminFromUser({ email: "owner@example.com", email_confirmed_at: null }, allowed)).toBe(
      null,
    );
    expect(
      adminFromUser({ email: "else@example.com", email_confirmed_at: confirmed }, allowed),
    ).toBe(null);
    expect(adminFromUser({ email_confirmed_at: confirmed }, allowed)).toBeNull();
    expect(adminFromUser(null, allowed)).toBeNull();
  });
});

describe("requestOrigin", () => {
  const origin = (h: Record<string, string>) => requestOrigin(new Headers(h));

  it("uses Vercel's forwarded host and always https for public hosts", () => {
    expect(
      origin({ "x-forwarded-host": "matzati-il.vercel.app", "x-forwarded-proto": "https" }),
    ).toBe("https://matzati-il.vercel.app");
    expect(origin({ host: "matzati-il.vercel.app", "x-forwarded-proto": "http" })).toBe(
      "https://matzati-il.vercel.app",
    );
  });

  it("prefers x-forwarded-host over host and takes the first of a list", () => {
    expect(origin({ "x-forwarded-host": "Matzati.co.il, proxy.internal", host: "10.0.0.1" })).toBe(
      "https://matzati.co.il",
    );
  });

  it("keeps http (and the port) for localhost", () => {
    expect(origin({ host: "localhost:3100" })).toBe("http://localhost:3100");
    expect(origin({ host: "localhost:3100", "x-forwarded-proto": "http" })).toBe(
      "http://localhost:3100",
    );
    expect(origin({ host: "127.0.0.1:3100", "x-forwarded-proto": "https" })).toBe(
      "https://127.0.0.1:3100",
    );
  });

  it("falls back to localhost when there is no host", () => {
    expect(origin({})).toBe(FALLBACK_ORIGIN);
    expect(FALLBACK_ORIGIN).toBe("http://localhost:3100");
  });

  it("refuses hosts that smuggle a path, credentials or another scheme", () => {
    for (const host of [
      "evil.com/admin",
      "user@evil.com",
      "evil.com?x=1",
      "evil.com#x",
      "javascript:alert(1)",
      "evil..com",
      "-evil.com",
      "evil.com\\@good.com",
      "[::1]:3100",
    ]) {
      expect(origin({ "x-forwarded-host": host })).toBe(FALLBACK_ORIGIN);
    }
  });

  it("builds the magic-link callback URL", () => {
    expect(authCallbackUrl("https://matzati-il.vercel.app")).toBe(
      "https://matzati-il.vercel.app/admin/auth/callback",
    );
    expect(authCallbackUrl(origin({ host: "localhost:3100" }))).toBe(
      "http://localhost:3100/admin/auth/callback",
    );
  });
});

describe("login error codes", () => {
  it("builds fixed, same-site login paths", () => {
    for (const e of LOGIN_ERRORS) {
      expect(loginErrorPath(e)).toBe(`${ADMIN_LOGIN_PATH}?error=${e}`);
      expect(loginErrorPath(e).startsWith("/admin/login?")).toBe(true);
    }
  });

  it("reads only known codes from the search params", () => {
    expect(loginErrorFromParam("link_expired")).toBe("link_expired");
    expect(loginErrorFromParam(["not_allowed", "x"])).toBe("not_allowed");
    expect(loginErrorFromParam("<script>")).toBeNull();
    expect(loginErrorFromParam("")).toBeNull();
    expect(loginErrorFromParam(undefined)).toBeNull();
    expect(loginErrorFromParam("toString")).toBeNull();
  });

  it("has a Hebrew message for every code", () => {
    for (const e of LOGIN_ERRORS) {
      expect(LOGIN_ERROR_MESSAGES[e]).toMatch(/[֐-׿]/);
      expect(LOGIN_ERROR_MESSAGES[e]).not.toMatch(/[a-z]/i);
    }
  });

  it("maps Supabase link errors from the callback query", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(linkErrorFromQuery(q("code=abc"))).toBeNull();
    expect(linkErrorFromQuery(q("error=access_denied&error_code=otp_expired"))).toBe(
      "link_expired",
    );
    expect(linkErrorFromQuery(q("error=server_error&error_code=unexpected_failure"))).toBe(
      "link_invalid",
    );
    expect(linkErrorFromQuery(q("error=access_denied"))).toBe("link_invalid");
  });

  it("maps code-exchange errors", () => {
    expect(exchangeErrorFor({ code: "pkce_code_verifier_not_found", status: 400 })).toBe(
      "other_browser",
    );
    expect(exchangeErrorFor({ name: "AuthPKCECodeVerifierMissingError", status: 400 })).toBe(
      "other_browser",
    );
    expect(exchangeErrorFor({ code: "bad_code_verifier", status: 400 })).toBe("other_browser");
    expect(exchangeErrorFor({ code: "flow_state_expired", status: 400 })).toBe("link_expired");
    expect(exchangeErrorFor({ code: "flow_state_not_found", status: 404 })).toBe("link_expired");
    expect(exchangeErrorFor({ code: "validation_failed", status: 400 })).toBe("link_invalid");
    expect(exchangeErrorFor({ name: "AuthRetryableFetchError", status: 0 })).toBe("unavailable");
    expect(exchangeErrorFor({ code: "unexpected_failure", status: 500 })).toBe("unavailable");
    expect(exchangeErrorFor(null)).toBe("unavailable");
  });
});

describe("login form results", () => {
  it("answers every valid address with the same non-revealing message", () => {
    expect(loginState("sent")).toEqual({
      status: "sent",
      message: "אם הכתובת מורשית, שלחנו אליה קישור כניסה.",
    });
    expect(LOGIN_MESSAGES.sent.startsWith("אם הכתובת מורשית, שלחנו אליה קישור כניסה")).toBe(true);
  });

  it("uses Hebrew, plural-address messages for the other states", () => {
    expect(loginState("invalid_email").message).toBe("כתבו כתובת אימייל תקינה.");
    expect(loginState("rate_limited").message).toContain("נסו שוב");
    expect(loginState("unavailable").message).toBe(LOGIN_ERROR_MESSAGES.unavailable);
  });

  it("pads fast answers up to the minimum response time", () => {
    expect(paddingMs(1_000, 1_000)).toBe(LOGIN_MIN_RESPONSE_MS);
    expect(paddingMs(1_000, 1_400, 1_500)).toBe(1_100);
    expect(paddingMs(1_000, 2_500, 1_500)).toBe(0);
    expect(paddingMs(1_000, 9_000, 1_500)).toBe(0);
  });
});

describe("isSupabaseAuthCookie", () => {
  it("matches the session cookie, its chunks and PKCE verifiers only", () => {
    expect(isSupabaseAuthCookie("sb-qrweqnryudxhcdkpvxtc-auth-token")).toBe(true);
    expect(isSupabaseAuthCookie("sb-qrweqnryudxhcdkpvxtc-auth-token.0")).toBe(true);
    expect(isSupabaseAuthCookie("sb-qrweqnryudxhcdkpvxtc-auth-token-code-verifier")).toBe(true);
    expect(isSupabaseAuthCookie("theme")).toBe(false);
    expect(isSupabaseAuthCookie("sb-other")).toBe(false);
  });
});

describe("authCookieOptions", () => {
  it("keeps the session away from page scripts, and https-only in production", () => {
    expect(authCookieOptions("production")).toEqual({ httpOnly: true, secure: true });
    expect(authCookieOptions("development")).toEqual({ httpOnly: true, secure: false });
    expect(authCookieOptions(undefined)).toEqual({ httpOnly: true, secure: false });
  });

  it("does not override SameSite or the cookie name (lax must reach the callback)", () => {
    expect(authCookieOptions("production")).not.toHaveProperty("sameSite");
    expect(authCookieOptions("production")).not.toHaveProperty("name");
  });
});

describe("newPasswordError", () => {
  it("accepts a long enough password typed twice", () => {
    expect(newPasswordError("correct horse battery", "correct horse battery")).toBeNull();
    expect(newPasswordError("סיסמה-ארוכה-מאוד", "סיסמה-ארוכה-מאוד")).toBeNull();
  });

  it("refuses a short one, a mismatch, edge spaces and missing fields", () => {
    expect(newPasswordError("short-pw-11", "short-pw-11")).toMatch(/12/);
    expect(newPasswordError("correct horse battery", "correct horse batterY")).toBe(
      "שתי הסיסמאות לא זהות.",
    );
    expect(newPasswordError(" correct horse battery", " correct horse battery")).toMatch(/רווח/);
    expect(newPasswordError(null, "x")).not.toBeNull();
    expect(newPasswordError("", "")).not.toBeNull();
  });

  it("refuses what bcrypt would cut: more than 72 bytes, Hebrew letters counting twice", () => {
    expect(newPasswordError("a".repeat(72), "a".repeat(72))).toBeNull();
    expect(newPasswordError("a".repeat(73), "a".repeat(73))).toMatch(/ארוכה/);
    expect(newPasswordError("א".repeat(37), "א".repeat(37))).toMatch(/ארוכה/);
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });
});
