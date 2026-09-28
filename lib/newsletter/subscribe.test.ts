import { describe, expect, it, vi } from "vitest";
import { hashIp, israelDayWindow } from "@/lib/guard/rate-limit";
import {
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_MESSAGES,
} from "./consent";
import { fakeNewsletterDb } from "./fake-db";
import { NEWSLETTER_SIGNUPS_PER_DAY } from "./rate-limit";
import { subscribe, unsubscribe, type NewsletterDeps } from "./subscribe";
import { isUnsubscribeToken } from "./token";

const NOW = new Date("2026-09-28T12:00:00Z");
const SALT = "test-salt";
const IP = "203.0.113.7";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const signup = (email: string, extra: Record<string, string> = {}) =>
  form({ email, consent: "yes", source: "footer", ...extra });

function setup(opts: Parameters<typeof fakeNewsletterDb>[0] = {}) {
  const fake = fakeNewsletterDb(opts);
  const log = vi.fn<(text: string) => void>();
  const dbFactory = vi.fn(() => fake.db);
  const deps = (over: Partial<NewsletterDeps> = {}): NewsletterDeps => ({
    db: dbFactory,
    headers: new Headers({ "x-forwarded-for": `${IP}, 10.0.0.1` }),
    salt: SALT,
    now: NOW,
    env: "production",
    log,
    ...over,
  });
  return { ...fake, log, dbFactory, deps };
}

const counterCalls = <T extends { fn: string }>(calls: T[]) =>
  calls.filter((c) => c.fn === "bump_counter");

describe("subscribe", () => {
  it("stores the address, the server's consent text and version, the source and a token", async () => {
    const t = setup();
    const state = await subscribe(signup("  Dana@Example.com "), t.deps());
    expect(state).toEqual({
      status: "subscribed",
      message: NEWSLETTER_MESSAGES.subscribed,
      email: "",
      consent: false,
    });
    const row = t.rows.get("dana@example.com");
    expect(row).toMatchObject({
      email: "dana@example.com",
      consent_text: NEWSLETTER_CONSENT_TEXT,
      consent_version: NEWSLETTER_CONSENT_VERSION,
      source: "footer",
      unsubscribed_at: null,
    });
    expect(isUnsubscribeToken(row?.unsubscribe_token)).toBe(true);
  });

  it("never takes the consent text or version from the form", async () => {
    const t = setup();
    await subscribe(
      signup("dana@example.com", { consent_text: "something else", consent_version: "v9" }),
      t.deps(),
    );
    expect(t.rows.get("dana@example.com")).toMatchObject({
      consent_text: NEWSLETTER_CONSENT_TEXT,
      consent_version: NEWSLETTER_CONSENT_VERSION,
    });
  });

  it("is idempotent: a second sign-up gets the same answer and changes nothing", async () => {
    const t = setup();
    const first = await subscribe(signup("dana@example.com"), t.deps());
    const before = structuredClone(t.rows.get("dana@example.com"));
    const second = await subscribe(signup("DANA@example.com"), t.deps());
    expect(second).toEqual(first);
    expect(t.rows.size).toBe(1);
    // The first consent and the first token stay.
    expect(t.rows.get("dana@example.com")).toEqual(before);
  });

  it("subscribes an unsubscribed address again with the new consent, keeping its token", async () => {
    const t = setup();
    await subscribe(signup("dana@example.com"), t.deps());
    const row = t.rows.get("dana@example.com")!;
    const token = row.unsubscribe_token;
    expect(await unsubscribe(form({ token }), t.deps())).toBe("done");
    expect(row.unsubscribed_at).not.toBeNull();
    const consentedBefore = row.consented_at;

    expect((await subscribe(signup("dana@example.com"), t.deps())).status).toBe("subscribed");
    expect(row.unsubscribed_at).toBeNull();
    expect(row.unsubscribe_token).toBe(token);
    expect(row.consented_at > consentedBefore).toBe(true);
  });

  it("answers a filled honeypot as a success without counting, storing or opening the database", async () => {
    const t = setup();
    const state = await subscribe(signup("dana@example.com", { website: "http://spam" }), t.deps());
    expect(state.status).toBe("subscribed");
    expect(state.message).toBe(NEWSLETTER_MESSAGES.subscribed);
    expect(t.calls).toEqual([]);
    expect(t.dbFactory).not.toHaveBeenCalled();
    expect(t.rows.size).toBe(0);
  });

  it("rejects an invalid address or a missing consent before counting anything", async () => {
    const t = setup();
    expect(await subscribe(form({ email: "dana@", consent: "yes" }), t.deps())).toEqual({
      status: "invalid_email",
      message: NEWSLETTER_MESSAGES.invalid_email,
      email: "dana@",
      consent: true,
    });
    expect(await subscribe(form({ email: "dana@example.com" }), t.deps())).toEqual({
      status: "consent_required",
      message: NEWSLETTER_MESSAGES.consent_required,
      email: "dana@example.com",
      consent: false,
    });
    expect(t.calls).toEqual([]);
    expect(t.dbFactory).not.toHaveBeenCalled();
  });

  it(`allows ${NEWSLETTER_SIGNUPS_PER_DAY} sign-ups per IP per Israel day, counted on the salted hash`, async () => {
    const t = setup();
    for (let i = 0; i < NEWSLETTER_SIGNUPS_PER_DAY; i++) {
      expect((await subscribe(signup(`user${i}@example.com`), t.deps())).status).toBe("subscribed");
    }
    const refused = await subscribe(signup("late@example.com"), t.deps());
    expect(refused).toMatchObject({
      status: "rate_limited",
      email: "late@example.com",
      consent: true,
    });
    expect(t.rows.has("late@example.com")).toBe(false);

    const bumps = counterCalls(t.calls);
    expect(new Set(bumps.map((c) => c.args.p_key))).toEqual(new Set([`nl:${hashIp(IP, SALT)}`]));
    expect(bumps[0]!.args.p_window_start).toBe(israelDayWindow(NOW).start.toISOString());
    // The raw IP never reaches the database.
    expect(JSON.stringify(t.calls)).not.toContain(IP);

    // Another IP has its own quota; the next Israel day starts a new window.
    const other = await subscribe(
      signup("other@example.com"),
      t.deps({ headers: new Headers({ "x-forwarded-for": "198.51.100.9" }) }),
    );
    expect(other.status).toBe("subscribed");
    const tomorrow = new Date(israelDayWindow(NOW).end.getTime() + 60_000);
    expect((await subscribe(signup("late@example.com"), t.deps({ now: tomorrow }))).status).toBe(
      "subscribed",
    );
  });

  it("counts a repeated address too (the limit is per IP, not per address)", async () => {
    const t = setup();
    for (let i = 0; i < NEWSLETTER_SIGNUPS_PER_DAY; i++) {
      await subscribe(signup("dana@example.com"), t.deps());
    }
    expect((await subscribe(signup("dana@example.com"), t.deps())).status).toBe("rate_limited");
  });

  it("keeps dev and preview counters apart from production's", async () => {
    const t = setup();
    await subscribe(signup("a@example.com"), t.deps({ env: "development" }));
    await subscribe(signup("b@example.com"), t.deps({ env: "preview" }));
    const keys = counterCalls(t.calls).map((c) => c.args.p_key);
    const hash = hashIp(IP, SALT);
    expect(keys).toEqual([`dev:nl:${hash}`, `preview:nl:${hash}`]);
  });

  it("refuses without a salt, and when the counter or the write fails, logging no address or IP", async () => {
    const noSalt = setup();
    expect((await subscribe(signup("dana@example.com"), noSalt.deps({ salt: " " }))).status).toBe(
      "unavailable",
    );
    expect(noSalt.calls).toEqual([]);

    const counter = setup({ failCounter: true });
    const refused = await subscribe(signup("dana@example.com"), counter.deps());
    expect(refused).toMatchObject({ status: "unavailable", email: "dana@example.com" });
    expect(counter.rows.size).toBe(0);

    const write = setup({ failWrite: true });
    expect((await subscribe(signup("dana@example.com"), write.deps())).status).toBe("unavailable");

    const noClient = setup();
    const missing = noClient.deps({
      db: () => {
        throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      },
    });
    expect((await subscribe(signup("dana@example.com"), missing)).status).toBe("unavailable");

    for (const t of [noSalt, counter, write, noClient]) {
      expect(t.log).toHaveBeenCalled();
      const logged = t.log.mock.calls.flat().join("\n");
      expect(logged).not.toContain("dana");
      expect(logged).not.toContain(IP);
    }
  });
});

describe("unsubscribe", () => {
  it("unsubscribes once and answers done again for the same token", async () => {
    const t = setup();
    await subscribe(signup("dana@example.com"), t.deps());
    const row = t.rows.get("dana@example.com")!;
    expect(await unsubscribe(form({ token: row.unsubscribe_token }), t.deps())).toBe("done");
    const at = row.unsubscribed_at;
    expect(at).not.toBeNull();
    expect(await unsubscribe(form({ token: row.unsubscribe_token }), t.deps())).toBe("done");
    expect(row.unsubscribed_at).toBe(at); // the first time is kept
  });

  it("answers invalid for a malformed token without the database, and for an unknown one", async () => {
    const t = setup();
    for (const token of ["", "short", `${"A".repeat(42)}=`]) {
      expect(await unsubscribe(form({ token }), t.deps())).toBe("invalid");
    }
    expect(await unsubscribe(new FormData(), t.deps())).toBe("invalid");
    expect(t.dbFactory).not.toHaveBeenCalled();
    expect(await unsubscribe(form({ token: "A".repeat(43) }), t.deps())).toBe("invalid");
  });

  it("answers error when the database fails", async () => {
    const t = setup({ failWrite: true });
    expect(await unsubscribe(form({ token: "A".repeat(43) }), t.deps())).toBe("error");
    expect(t.log.mock.calls.flat().join("\n")).not.toContain("A".repeat(43));
  });
});
