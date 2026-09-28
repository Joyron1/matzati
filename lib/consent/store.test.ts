import { describe, expect, it, vi } from "vitest";
import { ACCEPT_ALL, CONSENT_COOKIE, NECESSARY_ONLY, type ConsentState } from "./consent";
import {
  CONSENT_CHANGE_EVENT,
  CONSENT_OPEN_EVENT,
  createConsentStore,
  openConsentSettings,
  type ConsentEnv,
} from "./store";

const NOW = Date.UTC(2026, 8, 28, 12);

/** A cookie jar that behaves like document.cookie for one path (or refuses every write). */
function fakeEnv({ blocked = false, secure = true } = {}) {
  const jar = new Map<string, string>();
  const writes: string[] = [];
  let now = NOW;
  const env: ConsentEnv = {
    readCookies: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    writeCookie: (cookie) => {
      writes.push(cookie);
      if (blocked) return;
      const [pair] = cookie.split(";");
      const eq = pair.indexOf("=");
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    },
    secure: () => secure,
    target: new EventTarget(),
    now: () => now,
  };
  return { env, jar, writes, tick: (ms: number) => (now += ms) };
}

describe("createConsentStore", () => {
  it("has no choice before the visitor chooses", () => {
    const { env } = fakeEnv();
    expect(createConsentStore(env).getSnapshot()).toBeNull();
  });

  it("stores a choice in the cookie and reads it back", () => {
    const { env, writes } = fakeEnv();
    const store = createConsentStore(env);
    const saved = store.save(NECESSARY_ONLY);
    expect(saved).toMatchObject({ necessary: true, analytics: false, marketing: false, ts: NOW });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(new RegExp(`^${CONSENT_COOKIE}=.*; Secure$`));
    expect(store.getSnapshot()).toEqual(saved);
    // Another store (the next page load) sees the same choice.
    expect(createConsentStore(env).getSnapshot()).toEqual(saved);
  });

  it("writes no Secure flag on plain http (local dev)", () => {
    const { env, writes } = fakeEnv({ secure: false });
    createConsentStore(env).save(ACCEPT_ALL);
    expect(writes[0]).not.toContain("Secure");
  });

  it("returns the same object while the cookie is unchanged (useSyncExternalStore)", () => {
    const { env } = fakeEnv();
    const store = createConsentStore(env);
    store.save(ACCEPT_ALL);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    expect(first).not.toBeNull();
  });

  it("tells subscribers and the page when the choice changes", () => {
    const { env } = fakeEnv();
    const store = createConsentStore(env);
    const listener = vi.fn();
    const details: ConsentState[] = [];
    env.target.addEventListener(CONSENT_CHANGE_EVENT, (event) =>
      details.push((event as CustomEvent<ConsentState>).detail),
    );
    const unsubscribe = store.subscribe(listener);
    store.save(ACCEPT_ALL);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(details).toEqual([store.getSnapshot()]);
    unsubscribe();
    store.save(NECESSARY_ONLY);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(details).toHaveLength(2);
  });

  it("re-reads the cookie when the tab is shown again (a choice made in another tab)", () => {
    const { env } = fakeEnv();
    const store = createConsentStore(env);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toBeNull();
    // The other tab shares the cookie jar, not the window.
    createConsentStore({ ...env, target: new EventTarget() }).save(ACCEPT_ALL);
    expect(listener).not.toHaveBeenCalled();
    env.target.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()?.analytics).toBe(true);
  });

  it("a later choice replaces the earlier one", () => {
    const { env, tick } = fakeEnv();
    const store = createConsentStore(env);
    store.save(ACCEPT_ALL);
    tick(60_000);
    store.save(NECESSARY_ONLY);
    expect(store.getSnapshot()).toMatchObject({ analytics: false, ts: NOW + 60_000 });
  });

  it("asks again once the stored choice is too old", () => {
    const { env, tick } = fakeEnv();
    createConsentStore(env).save(ACCEPT_ALL);
    tick(366 * 86_400_000);
    expect(createConsentStore(env).getSnapshot()).toBeNull();
  });

  it("ignores a cookie from another policy version", () => {
    const { env, jar } = fakeEnv();
    jar.set(
      CONSENT_COOKIE,
      encodeURIComponent(
        JSON.stringify({ v: 0, necessary: true, analytics: true, marketing: true, ts: NOW }),
      ),
    );
    expect(createConsentStore(env).getSnapshot()).toBeNull();
  });

  it("keeps a choice for this page view when the browser blocks cookies", () => {
    const { env, jar } = fakeEnv({ blocked: true });
    const store = createConsentStore(env);
    store.save(NECESSARY_ONLY);
    expect(jar.size).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ analytics: false, marketing: false });
    // A new page load asks again, since nothing was stored.
    expect(createConsentStore(env).getSnapshot()).toBeNull();
  });

  it("survives a document.cookie that throws (sandboxed frame)", () => {
    const { env } = fakeEnv();
    const store = createConsentStore({
      ...env,
      readCookies: () => {
        throw new DOMException("sandboxed", "SecurityError");
      },
      writeCookie: () => {
        throw new DOMException("sandboxed", "SecurityError");
      },
    });
    expect(store.getSnapshot()).toBeNull();
    expect(store.save(ACCEPT_ALL).analytics).toBe(true);
    expect(store.getSnapshot()?.analytics).toBe(true);
  });
});

describe("openConsentSettings", () => {
  it("fires the open event on the given target", () => {
    const target = new EventTarget();
    const opened = vi.fn();
    target.addEventListener(CONSENT_OPEN_EVENT, opened);
    openConsentSettings(target);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
