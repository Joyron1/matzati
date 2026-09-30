// The /admin/login server action end to end, with fakes for Next's request APIs, the rate-limit
// database and Supabase Auth (nothing leaves the test): the response must not reveal whether an
// address is an admin, and only admin addresses may reach Supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestMagicLink } from "@/app/(admin-public)/admin/login/actions";
import type { LoginState } from "./rules";

const m = vi.hoisted(() => ({
  headers: new Headers(),
  cookieStore: null as unknown,
  counts: new Map<string, number>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => m.headers,
  cookies: async () => m.cookieStore,
}));
vi.mock("@/lib/supabase/server", () => ({
  serviceClient: () => ({
    async rpc(_fn: string, args: { p_key: string; p_window_start: string }) {
      const key = `${args.p_key}@${args.p_window_start}`;
      const next = (m.counts.get(key) ?? 0) + 1;
      m.counts.set(key, next);
      return { data: next, error: null };
    },
  }),
}));
// The 1.5 s padding is tested in rules.test.ts; here it would only slow the suite down.
vi.mock("./rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rules")>()),
  paddingMs: () => 0,
}));

const ADMIN = "owner@example.com";
const OTHER = "someone@example.com";
const IDLE: LoginState = { status: "idle", message: "" };

interface Write {
  name: string;
  value: string;
  options: unknown;
}

/** Next's cookie store as a server action sees it: the last write per name is what gets sent. */
function cookieJar() {
  const jar = new Map<string, string>();
  const writes: Write[] = [];
  m.cookieStore = {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: unknown) => {
      writes.push({ name, value, options });
      if (value) jar.set(name, value);
      else jar.delete(name);
    },
  };
  return writes;
}

/** Set-Cookie headers of the response, with the random flow ids and values reduced to shapes. */
function sent(writes: Write[]) {
  const last = new Map(writes.map((w) => [w.name, w]));
  return [...last.values()]
    .map((w) => ({
      name: w.name.replace(/-flow-[A-Za-z0-9_-]+-code-verifier$/, "-flow-<id>-code-verifier"),
      length: w.value.length,
      options: w.options,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function submit(email: string) {
  const writes = cookieJar();
  const form = new FormData();
  form.set("email", email);
  const state = await requestMagicLink(IDLE, form);
  return { state, cookies: sent(writes) };
}

/** Supabase Auth's /otp: ok, or its per-address "too soon" refusal. */
function supabase(status: 200 | 429) {
  const body =
    status === 200
      ? {}
      : { code: 429, error_code: "over_email_send_rate_limit", msg: "try again later" };
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("ADMIN_EMAILS", ADMIN);
  vi.stubEnv("IP_HASH_SALT", "test-salt");
  vi.stubGlobal("WebSocket", class {}); // supabase-js needs one to exist on Node 20
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.headers = new Headers({ host: "localhost:3100", "x-forwarded-for": "203.0.113.7" });
  m.counts.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestMagicLink", () => {
  it("sends the link to an admin address only, with the callback as the redirect", async () => {
    const auth = supabase(200);
    vi.stubGlobal("fetch", auth);

    expect((await submit(OTHER)).state.status).toBe("sent");
    expect(auth).not.toHaveBeenCalled();

    expect((await submit(ADMIN.toUpperCase())).state.status).toBe("sent");
    expect(auth).toHaveBeenCalledTimes(1);
    const url = new URL(String(auth.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://abcdefghijklmnopqrst.supabase.co/auth/v1/otp");
    expect(url.searchParams.get("redirect_to")).toBe("http://localhost:3100/admin/auth/callback");
    const body = JSON.parse(String(auth.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ email: ADMIN, create_user: true, code_challenge_method: "s256" });
  });

  it("answers an admin and any other address with the same message and the same cookies", async () => {
    vi.stubGlobal("fetch", supabase(200));
    const admin = await submit(ADMIN);
    const other = await submit(OTHER);

    expect(other.state).toEqual(admin.state);
    expect(admin.state.message).toBe("אם הכתובת מורשית, שלחנו אליה קישור כניסה.");
    expect(admin.cookies.length).toBeGreaterThan(0); // the PKCE verifier the callback needs
    expect(other.cookies).toEqual(admin.cookies);
  });

  it("keeps the cookies the same when Supabase refuses the send", async () => {
    vi.stubGlobal("fetch", supabase(429));
    const admin = await submit(ADMIN);
    const other = await submit(OTHER);

    expect(other.state).toEqual(admin.state);
    expect(admin.cookies.length).toBeGreaterThan(0);
    expect(other.cookies).toEqual(admin.cookies);
  });

  it("writes the auth cookies httpOnly", async () => {
    vi.stubGlobal("fetch", supabase(200));
    const { cookies } = await submit(ADMIN);
    for (const c of cookies) expect(c.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
  });

  it("refuses the eleventh request in an hour from one IP, admin or not", async () => {
    const auth = supabase(200);
    vi.stubGlobal("fetch", auth);
    for (let i = 0; i < 10; i++) expect((await submit(OTHER)).state.status).toBe("sent");
    const refused = await submit(ADMIN);
    expect(refused.state.status).toBe("rate_limited");
    expect(refused.cookies).toEqual([]);
    expect(auth).not.toHaveBeenCalled();
  });

  it("rejects an invalid address before counting or sending anything", async () => {
    const auth = supabase(200);
    vi.stubGlobal("fetch", auth);
    expect((await submit("not-an-email")).state.status).toBe("invalid_email");
    expect(m.counts.size).toBe(0);
    expect(auth).not.toHaveBeenCalled();
  });
});
