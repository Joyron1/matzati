import { describe, expect, it, vi } from "vitest";
import type { MoreResult, SearchPageResult } from "@/lib/search/server";
import type { FilterChip, SearchResponse } from "@/lib/types";
import { handleIncoming, type BotDeps } from "./bot";
import type { WhatsAppSender } from "./client";
import type { Inbound } from "./inbound";
import type { WaMessage } from "./messages";
import { MemorySessionStore, userHashOf } from "./session";
import { assertWithinLimits, product } from "./testkit";

const SALT = "test-salt-123";
const USER = "972501234567";
const NOW = new Date("2026-09-29T10:00:00Z");

const chips: FilterChip[] = [
  { id: "product", kind: "keywords", label_he: "אוזניות לריצה", removable: false },
  { id: "max", kind: "max_price", label_he: "עד ₪100", removable: true },
];

const response = (over: Partial<SearchResponse> = {}) =>
  ({
    query: "אוזניות",
    chips,
    sort: "best_value",
    checked_count: 98,
    passed_count: 12,
    results: [1, 2, 3, 4, 5].map((n) => product({ product_id: String(1000 + n) })),
    more_available: true,
    filters_key: "a".repeat(64),
    ...over,
  }) as SearchResponse;

function setup(over: Partial<BotDeps> = {}) {
  const sent: { to: string; message: WaMessage; replyTo?: string | undefined }[] = [];
  const sender: WhatsAppSender = {
    async send(to, message, replyTo) {
      sent.push({ to, message, replyTo });
    },
    markReadTyping: vi.fn(async () => undefined),
  };
  const sessions = new MemorySessionStore();
  const search = vi.fn<BotDeps["search"]>(async (): Promise<SearchPageResult> => ({
    ok: true,
    response: response() as never,
  }));
  const more = vi.fn<BotDeps["more"]>(async (): Promise<MoreResult> => ({
    ok: true,
    results: [6, 7, 8, 9, 10].map((n) => product({ product_id: String(1000 + n) })) as never,
    more_available: false,
  }));
  const deps: BotDeps = {
    sender,
    sessions,
    salt: SALT,
    search,
    more,
    hot: async () => [],
    coupons: async () => [],
    nextSale: async () => null,
    now: () => NOW,
    slowAfterMs: 10_000,
    ...over,
  };
  const text = (body: string, id = "wamid.t1"): Inbound => ({
    kind: "text",
    id,
    from: USER,
    text: body,
  });
  const action = (actionId: string, id = "wamid.a1"): Inbound => ({
    kind: "action",
    id,
    from: USER,
    actionId,
  });
  return { deps, sent, sessions, search, more, text, action, sender };
}

const kinds = (sent: { message: WaMessage }[]) =>
  sent.map((s) => (s.message.type === "text" ? "text" : s.message.interactive.type));

describe("a search", () => {
  it("answers with a summary, five photo cards, buttons and a filter list", async () => {
    const t = setup();
    await handleIncoming(t.text("אוזניות לריצה, עד 100"), t.deps);
    expect(kinds(t.sent)).toEqual([
      "text",
      "cta_url",
      "cta_url",
      "cta_url",
      "cta_url",
      "cta_url",
      "button",
      "list",
    ]);
    for (const s of t.sent) {
      expect(s.to).toBe(USER);
      assertWithinLimits(s.message);
    }
    // The summary quotes the user's message; the cards do not.
    expect(t.sent[0]!.replyTo).toBe("wamid.t1");
    expect(t.sent[1]!.replyTo).toBeUndefined();
    expect(t.sender.markReadTyping).toHaveBeenCalledWith("wamid.t1");
  });

  it("searches with the user's own text, not as a public typed search, limited per user not per IP", async () => {
    const t = setup();
    await handleIncoming(t.text("אוזניות לריצה"), t.deps);
    const [input, headers] = t.search.mock.calls[0]!;
    expect(input).toEqual({ q: "אוזניות לריצה", without: [], typed: false });
    const hash = userHashOf(USER, SALT);
    expect(headers.get("x-forwarded-for")).toBe(`wa:${hash}`);
    // No raw phone number reaches the rate limiter or the session table.
    expect(headers.get("x-forwarded-for")).not.toContain(USER);
    expect([...t.sessions.sessions.keys()]).toEqual([hash]);
  });

  it("remembers the search so 'more', a sort and a removed filter can repeat it", async () => {
    const t = setup();
    await handleIncoming(t.text("אוזניות לריצה", "m1"), t.deps);
    const session = t.sessions.sessions.get(userHashOf(USER, SALT))!;
    expect(session).toMatchObject({
      q: "אוזניות לריצה",
      without: [],
      page: 0,
      moreAvailable: true,
      shownSort: "best_value",
    });

    await handleIncoming(t.action("sort:cheapest", "m2"), t.deps);
    expect(t.search.mock.calls[1]![0]).toMatchObject({
      q: "אוזניות לריצה",
      without: [],
      sort: "cheapest",
    });

    await handleIncoming(t.action("drop:max", "m3"), t.deps);
    expect(t.search.mock.calls[2]![0]).toMatchObject({
      q: "אוזניות לריצה",
      without: ["max"],
      sort: "cheapest",
    });
  });

  it("shows the help for a search with no results and offers to drop a filter", async () => {
    const t = setup();
    t.search.mockResolvedValueOnce({
      ok: true,
      response: response({ results: [], passed_count: 0, more_available: false }) as never,
    });
    await handleIncoming(t.text("משהו נדיר"), t.deps);
    expect(kinds(t.sent)).toEqual(["text", "list"]);
    for (const s of t.sent) assertWithinLimits(s.message);
    expect(t.sessions.sessions.get(userHashOf(USER, SALT))!.filtersKey).not.toBeNull();
  });

  it("tells the user what went wrong, in Hebrew, and keeps going", async () => {
    const t = setup();
    t.search.mockResolvedValueOnce({ ok: false, error: "rate_limited", retryAfterSec: 1200 });
    await handleIncoming(t.text("אוזניות"), t.deps);
    expect(t.sent).toHaveLength(1);
    expect(JSON.stringify(t.sent[0]!.message)).toContain("20 דקות");
  });

  it("sends 'one moment' once when the search is slow, before the results", async () => {
    const t = setup({ slowAfterMs: 5 });
    t.search.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, response: response() as never };
    });
    await handleIncoming(t.text("אוזניות"), t.deps);
    expect(JSON.stringify(t.sent[0]!.message)).toContain("עוד רגע");
    expect(t.sent).toHaveLength(9);
  });
});

describe("more", () => {
  it("shows places 6-10 and stops offering more when there is none", async () => {
    const t = setup();
    await handleIncoming(t.text("אוזניות", "m1"), t.deps);
    t.sent.length = 0;
    await handleIncoming(t.action("more", "m2"), t.deps);
    expect(t.more).toHaveBeenCalledWith("a".repeat(64), 1, expect.any(Headers));
    expect(kinds(t.sent)).toEqual([
      "text",
      "cta_url",
      "cta_url",
      "cta_url",
      "cta_url",
      "cta_url",
      "button",
    ]);
    expect(JSON.stringify(t.sent[1]!.message)).toContain("*6.");
    const buttons = JSON.stringify(t.sent.at(-1)!.message);
    expect(buttons).not.toContain('"id":"more"');
    expect(t.sessions.sessions.get(userHashOf(USER, SALT))).toMatchObject({
      page: 1,
      moreAvailable: false,
    });
    // Asking again says it is over instead of calling the site.
    t.more.mockClear();
    await handleIncoming(t.text("עוד", "m3"), t.deps);
    expect(t.more).not.toHaveBeenCalled();
  });

  it("asks for a new search when nothing is remembered", async () => {
    const t = setup();
    await handleIncoming(t.action("more"), t.deps);
    expect(JSON.stringify(t.sent[0]!.message)).toContain("כתבו חיפוש חדש");
    expect(t.more).not.toHaveBeenCalled();
  });
});

describe("commands", () => {
  it("shows the menu for a greeting, a stale id, and a voice note gets a polite refusal", async () => {
    const t = setup();
    await handleIncoming(t.text("שלום", "1"), t.deps);
    await handleIncoming(t.action("nonsense", "2"), t.deps);
    await handleIncoming({ kind: "unsupported", id: "3", from: USER }, t.deps);
    expect(kinds(t.sent)).toEqual(["list", "list", "text"]);
    expect(JSON.stringify(t.sent[2]!.message)).toContain("רק הודעות טקסט");
    expect(t.search).not.toHaveBeenCalled();
  });

  it("sends the hot list as an intro and photo cards", async () => {
    const hotOne = (n: number) => ({
      productId: `77${n}`,
      title: `מוצר חם ${n}`,
      imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/h.jpg",
      price: 7.8,
      originalPrice: null,
      discountPct: null,
      positiveFeedbackPct: 95,
      unitsSold: 500,
      hasVideo: false,
      promoCode: null,
      categoryId: null,
      subcategoryId: null,
      shopId: null,
    });
    const t = setup({ hot: async () => [1, 2, 3, 4, 5, 6, 7].map(hotOne) });
    await handleIncoming(t.text("מוצרים חמים"), t.deps);
    expect(kinds(t.sent)).toEqual(["text", "cta_url", "cta_url", "cta_url", "cta_url", "cta_url"]);
    for (const s of t.sent) assertWithinLimits(s.message);
  });

  it("says the hot list is unavailable when it is empty", async () => {
    const t = setup();
    await handleIncoming(t.text("חמים"), t.deps);
    expect(JSON.stringify(t.sent[0]!.message)).toContain("לא זמינה");
  });

  it("answers coupons and sales from the site's readers", async () => {
    const t = setup({
      coupons: async () => [
        {
          id: "1",
          code: "SAVE5",
          title: "₪5 הנחה",
          terms: null,
          min_spend_ils: null,
          scope: "sitewide",
          product_id: null,
          sale_id: null,
          starts_at: null,
          ends_at: null,
          featured: true,
          published: true,
          created_at: "",
          updated_at: "",
        },
      ],
    });
    await handleIncoming(t.text("קופונים", "1"), t.deps);
    await handleIncoming(t.text("מבצעים", "2"), t.deps);
    expect(JSON.stringify(t.sent[0]!.message)).toContain("SAVE5");
    expect(JSON.stringify(t.sent[1]!.message)).toContain("/sales");
  });

  it("'stop' forgets the last search", async () => {
    const t = setup();
    await handleIncoming(t.text("אוזניות", "1"), t.deps);
    expect(t.sessions.sessions.size).toBe(1);
    await handleIncoming(t.text("עצור", "2"), t.deps);
    expect(t.sessions.sessions.size).toBe(0);
  });

  it("refuses a query that is too long without searching", async () => {
    const t = setup();
    await handleIncoming(t.text("א".repeat(300)), t.deps);
    expect(t.search).not.toHaveBeenCalled();
    expect(JSON.stringify(t.sent[0]!.message)).toContain("ארוך מדי");
  });
});

describe("safety", () => {
  it("answers a redelivered message only once", async () => {
    const t = setup();
    await handleIncoming(t.text("אוזניות", "same-id"), t.deps);
    const count = t.sent.length;
    await handleIncoming(t.text("אוזניות", "same-id"), t.deps);
    expect(t.sent).toHaveLength(count);
    expect(t.search).toHaveBeenCalledTimes(1);
  });

  it("never throws: a crash is logged and the user gets an apology", async () => {
    const log = vi.fn();
    const t = setup({ log });
    t.search.mockRejectedValueOnce(new Error("boom"));
    await expect(handleIncoming(t.text("אוזניות"), t.deps)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("whatsapp", expect.any(Error));
    expect(JSON.stringify(t.sent.at(-1)!.message)).toContain("השתבש");
  });

  it("still sends the results when the session store is down", async () => {
    const log = vi.fn();
    const t = setup({ log });
    t.sessions.set = async () => {
      throw new Error("table missing");
    };
    await handleIncoming(t.text("אוזניות"), t.deps);
    expect(kinds(t.sent)).toEqual([
      "text",
      "cta_url",
      "cta_url",
      "cta_url",
      "cta_url",
      "cta_url",
      "button",
      "list",
    ]);
    expect(log).toHaveBeenCalledWith("whatsapp_session", expect.any(Error));
  });

  it("does not stop when the typing indicator fails", async () => {
    const t = setup();
    (t.sender.markReadTyping as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    await handleIncoming(t.text("אוזניות"), t.deps);
    expect(t.sent.length).toBeGreaterThan(5);
  });
});
