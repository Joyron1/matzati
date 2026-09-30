// The /admin/login password action end to end, with fakes for Next's request APIs, the rate-limit
// database and Supabase Auth (nothing leaves the test): a wrong password and a non-admin address
// get the same answer and the same cookies (none), only admin addresses reach Supabase, and the
// session cookies are written only for a confirmed admin who signed in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithPassword } from "@/app/(admin-public)/admin/login/actions";
import type { PasswordLoginState } from "./rules";

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
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
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
const PASSWORD = "correct horse battery";
const IDLE: PasswordLoginState = { status: "idle", message: "" };

function cookieJar() {
  const writes: { name: string; value: string; options: unknown }[] = [];
  m.cookieStore = {
    getAll: () => [],
    set: (name: string, value: string, options: unknown) => writes.push({ name, value, options }),
  };
  return writes;
}

async function submit(email: string, password = PASSWORD) {
  const writes = cookieJar();
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  try {
    const state = await signInWithPassword(IDLE, form);
    return { state, redirectedTo: null as string | null, writes };
  } catch (err) {
    const to = (err as { to?: string }).to;
    if (!to) throw err;
    return { state: null, redirectedTo: to, writes };
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Supabase Auth's /token?grant_type=password: a session, or its refusal. */
function supabase(answer: "ok" | "unconfirmed" | "wrong" | "down") {
  return vi.fn<typeof fetch>(async (input) => {
    expect(String(input)).toContain("/auth/v1/token?grant_type=password");
    if (answer === "wrong") {
      return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login" });
    }
    if (answer === "down") return json(503, { code: 503, msg: "unavailable" });
    const now = Math.floor(Date.now() / 1000);
    return json(200, {
      access_token: "header.payload.signature",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: "refresh-token",
      user: {
        id: "00000000-0000-0000-0000-000000000001",
        aud: "authenticated",
        email: ADMIN,
        email_confirmed_at: answer === "ok" ? new Date().toISOString() : null,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    });
  });
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

describe("signInWithPassword", () => {
  it("signs a confirmed admin in: the session cookies, httpOnly, then /admin", async () => {
    const auth = supabase("ok");
    vi.stubGlobal("fetch", auth);
    const { redirectedTo, writes } = await submit(ADMIN.toUpperCase());
    expect(redirectedTo).toBe("/admin");
    expect(auth).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(auth.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ email: ADMIN, password: PASSWORD });
    const session = writes.filter((w) => w.name.includes("-auth-token") && w.value);
    expect(session.length).toBeGreaterThan(0);
    for (const w of session) expect(w.options).toMatchObject({ httpOnly: true });
  });

  it("answers a wrong password and a non-admin address alike, with no cookies", async () => {
    const auth = supabase("wrong");
    vi.stubGlobal("fetch", auth);
    const wrong = await submit(ADMIN, "not the password");
    const other = await submit(OTHER);
    expect(wrong.state).toEqual({
      status: "wrong_credentials",
      message: "האימייל או הסיסמה לא נכונים.",
    });
    expect(other.state).toEqual(wrong.state);
    expect(wrong.writes).toEqual([]);
    expect(other.writes).toEqual([]);
    // Only the admin address reached Supabase.
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it("gives an admin address that is not confirmed no session", async () => {
    vi.stubGlobal("fetch", supabase("unconfirmed"));
    const { state, redirectedTo, writes } = await submit(ADMIN);
    expect(redirectedTo).toBeNull();
    expect(state?.status).toBe("wrong_credentials");
    expect(writes).toEqual([]);
  });

  it("says to try later when Supabase Auth is down", async () => {
    vi.stubGlobal("fetch", supabase("down"));
    expect((await submit(ADMIN)).state?.status).toBe("unavailable");
  });

  it("rejects a missing or over-long password before counting or sending anything", async () => {
    const auth = supabase("ok");
    vi.stubGlobal("fetch", auth);
    expect((await submit(ADMIN, "")).state?.status).toBe("invalid_input");
    expect((await submit(ADMIN, "א".repeat(40))).state?.status).toBe("invalid_input"); // 80 bytes
    expect((await submit("not-an-email")).state?.status).toBe("invalid_input");
    expect(m.counts.size).toBe(0);
    expect(auth).not.toHaveBeenCalled();
  });

  it("refuses the eleventh attempt in an hour from one IP, without calling Supabase", async () => {
    const auth = supabase("wrong");
    vi.stubGlobal("fetch", auth);
    for (let i = 0; i < 10; i++)
      expect((await submit(OTHER)).state?.status).toBe("wrong_credentials");
    const refused = await submit(ADMIN);
    expect(refused.state?.status).toBe("rate_limited");
    expect(auth).not.toHaveBeenCalled();
  });
});
