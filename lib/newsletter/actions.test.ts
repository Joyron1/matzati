// The newsletter's server actions end to end, with fakes for Next's request APIs and the database
// (nothing leaves the test): the request's IP and the salt reach the rate limit, and the
// unsubscribe button redirects to a URL without the token.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashIp } from "@/lib/guard/rate-limit";
import { subscribeToNewsletter, unsubscribeFromNewsletter } from "./actions";
import { NEWSLETTER_IDLE } from "./consent";
import { fakeNewsletterDb } from "./fake-db";

const m = vi.hoisted(() => ({
  headers: new Headers(),
  fake: null as unknown as ReturnType<typeof import("./fake-db").fakeNewsletterDb>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => m.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => m.fake.db }));

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  return (err as { url: string }).url;
}

beforeEach(() => {
  vi.stubEnv("IP_HASH_SALT", "test-salt");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  m.fake = fakeNewsletterDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("subscribeToNewsletter", () => {
  it("counts the request's salted IP and stores the address", async () => {
    const state = await subscribeToNewsletter(
      NEWSLETTER_IDLE,
      form({ email: "dana@example.com", consent: "yes", source: "footer" }),
    );
    expect(state.status).toBe("subscribed");
    expect(m.fake.calls[0]!.args.p_key).toBe(`nl:${hashIp("203.0.113.7", "test-salt")}`);
    expect(m.fake.rows.has("dana@example.com")).toBe(true);
  });

  it("refuses without IP_HASH_SALT", async () => {
    vi.stubEnv("IP_HASH_SALT", "");
    const state = await subscribeToNewsletter(
      NEWSLETTER_IDLE,
      form({ email: "dana@example.com", consent: "yes" }),
    );
    expect(state.status).toBe("unavailable");
    expect(m.fake.calls).toEqual([]);
  });

  it("uses the dev counter outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    await subscribeToNewsletter(NEWSLETTER_IDLE, form({ email: "a@example.com", consent: "yes" }));
    expect(m.fake.calls[0]!.args.p_key).toMatch(/^dev:nl:[0-9a-f]{64}$/);
  });
});

describe("unsubscribeFromNewsletter", () => {
  it("unsubscribes and redirects to the done page without the token", async () => {
    await subscribeToNewsletter(
      NEWSLETTER_IDLE,
      form({ email: "dana@example.com", consent: "yes" }),
    );
    const token = m.fake.rows.get("dana@example.com")!.unsubscribe_token;
    const url = await redirectOf(unsubscribeFromNewsletter(form({ token })));
    expect(url).toBe("/newsletter/unsubscribe?status=done");
    expect(m.fake.rows.get("dana@example.com")!.unsubscribed_at).not.toBeNull();
  });

  it("redirects an unknown or malformed token to the invalid page", async () => {
    expect(await redirectOf(unsubscribeFromNewsletter(form({ token: "A".repeat(43) })))).toBe(
      "/newsletter/unsubscribe?status=invalid",
    );
    expect(await redirectOf(unsubscribeFromNewsletter(form({ token: "<script>" })))).toBe(
      "/newsletter/unsubscribe?status=invalid",
    );
  });

  it("returns to the same token after a database failure", async () => {
    m.fake = fakeNewsletterDb({ failWrite: true });
    const token = "B".repeat(43);
    expect(await redirectOf(unsubscribeFromNewsletter(form({ token })))).toBe(
      `/newsletter/unsubscribe?token=${token}&status=error`,
    );
  });
});
