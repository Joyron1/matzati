import { describe, expect, it, vi } from "vitest";
import type { ResultProduct } from "@/lib/types";
import { ruleVerdict } from "./filter";
import { CAPTION_LIMIT, groupCaption, visibleLength } from "./format";
import { handleUpdate, NOTE_MS, type GroupDeps, type TgUpdate } from "./handle";
import { pollDue, pollOptions, POLL_OTHER, weeklySlot } from "./poll";

const product = (o: Partial<ResultProduct> = {}): ResultProduct =>
  ({
    product_id: "1005001",
    title_he: "אוהל קל משקל לשני אנשים עמיד למים עם מוטות אלומיניום",
    title_en: "Ultralight 2 person tent",
    why_he: "",
    price_ils: 562,
    original_price_ils: null,
    price_is_approx: false,
    discount_pct: null,
    positive_feedback_pct: 98,
    units_sold: 1384,
    image_urls: ["https://ae01.alicdn.com/a.jpg"],
    passed_tier: "standard",
    ...o,
  }) as ResultProduct;

describe("the rules", () => {
  it("lets product searches through", () => {
    for (const q of ["אוהל קל ל 2", "מטען מהיר לאייפון 15", "מתנה לאבא שאוהב לבשל", "usb c hub"]) {
      expect(ruleVerdict(q).kind, q).toBe("check");
    }
  });
  it("rejects links, mentions, phones, chat, emoji and commands", () => {
    const reasons = [
      ["https://a.aliexpress.com/_x", "link"],
      ["מישהו יודע? @dani", "mention"],
      ["תתקשרו 050-1234567", "phone"],
      ["תודה!", "chat"],
      ["חחחחח", "chat"],
      ["😂😂😂", "no_letters"],
      ["/start", "command"],
      ["א", "too_short"],
      ["א".repeat(200), "too_long"],
    ] as const;
    for (const [text, reason] of reasons) {
      expect(ruleVerdict(text), text).toEqual({ kind: "reject", reason });
    }
  });
});

describe("the caption", () => {
  it("lists five products with medals, numbers and direct links, within Telegram's limit", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      product: product({
        product_id: String(i),
        title_he: "כ".repeat(120),
        promo_code: { code: "ILAFFOCT04", starts_at: null, ends_at: null },
      }),
      link: `https://s.click.aliexpress.com/e/_${i}`,
    }));
    const c = groupCaption("אוהל קל ל 2", items, Date.parse("2026-10-25T10:00:00Z"));
    expect(visibleLength(c)).toBeLessThanOrEqual(CAPTION_LIMIT);
    for (const medal of ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]) expect(c).toContain(medal);
    expect(c).toContain('href="https://s.click.aliexpress.com/e/_4"');
    expect(c).toContain("<code>ILAFFOCT04</code>");
    expect(c).toContain("1,384");
    expect(c).toContain("98%");
    expect(c).toContain("קישורי שותפים");
  });
  it("says 'פחות מוכח' for a loose-tier product and escapes HTML", () => {
    const c = groupCaption("a<b>", [
      { product: product({ passed_tier: "loose", title_he: "<script>" }), link: "https://x" },
    ]);
    expect(c).toContain("פחות מוכח");
    expect(c).not.toContain("<script>");
    expect(c).toContain("a&lt;b&gt;");
  });
});

describe("the weekly poll", () => {
  it("is due once Sunday 12:00 Israel time has passed, once a week", () => {
    const sundayNoon = new Date("2026-10-25T10:00:00Z"); // 12:00 Israel (winter, UTC+2)
    expect(weeklySlot(new Date("2026-10-26T08:00:00Z")).toISOString()).toBe(
      sundayNoon.toISOString(),
    );
    expect(pollDue(new Date("2026-10-25T09:59:00Z"), new Date("2026-10-18T10:00:00Z"))).toBe(false);
    expect(pollDue(new Date("2026-10-25T10:00:00Z"), new Date("2026-10-18T10:00:00Z"))).toBe(true);
    expect(pollDue(new Date("2026-10-27T10:00:00Z"), sundayNoon)).toBe(false);
    expect(pollDue(new Date("2026-10-27T10:00:00Z"), null)).toBe(true);
  });
  it("has at most 10 options, ending with 'other'", () => {
    const o = pollOptions(new Date("2026-10-25T10:00:00Z"));
    expect(o.length).toBeLessThanOrEqual(10);
    expect(o.at(-1)).toBe(POLL_OTHER);
  });
});

function setup(over: Partial<GroupDeps> = {}) {
  const calls: { method: string; payload: Record<string, unknown>; photo: boolean }[] = [];
  let id = 100;
  const deps: GroupDeps = {
    searchChatId: async () => "-100",
    send: vi.fn(async (method, payload, photo) => {
      calls.push({ method, payload, photo: !!photo });
      return { ok: true, messageId: ++id };
    }),
    isProductSearch: async () => true,
    withinLimit: async () => true,
    search: async () => ({ ok: true, products: [product(), product({ product_id: "2" })] }),
    linkFor: async (pid) => `https://s.click.aliexpress.com/e/_${pid}`,
    collage: async () => Buffer.from("jpeg"),
    describe: async () =>
      new Map([
        ["1005001", { name: "אוהל קל לשניים", line: "אוהל עמיד למים עם מוטות אלומיניום." }],
      ]),
    couponsText: async () => "<b>קופונים</b>",
    siteSearchUrl: (q) => `https://www.matzati-il.com/search?q=${encodeURIComponent(q)}`,
    noteChat: vi.fn(async () => {}),
    knownChat: async () => true,
    chatStatus: async () => "administrator",
    updatePoll: vi.fn(async () => {}),
    linkOwner: async () => false,
    sleep: vi.fn(async () => {}),
    log: () => {},
    ...over,
  };
  return { deps, calls };
}

const groupMessage = (text: string | undefined, o: Record<string, unknown> = {}): TgUpdate => ({
  update_id: 1,
  message: {
    message_id: 55,
    date: 1,
    chat: { id: -100, type: "supergroup", title: "חיפושים" },
    from: { id: 7, first_name: "דנה" },
    ...(text === undefined ? {} : { text }),
    ...o,
  },
});

describe("the search group", () => {
  it("answers a search with the collage, the caption and the two buttons, as a reply", async () => {
    const { deps, calls } = setup();
    await handleUpdate(groupMessage("אוהל קל ל 2"), deps);
    const photo = calls.find((c) => c.method === "sendPhoto")!;
    expect(photo.photo).toBe(true);
    expect(photo.payload.reply_parameters).toMatchObject({ message_id: 55 });
    expect(String(photo.payload.caption)).toContain("🥇");
    const keyboard = (photo.payload.reply_markup as { inline_keyboard: { text: string }[][] })
      .inline_keyboard[0]!;
    expect(keyboard.map((b) => b.text)).toEqual(["🔎 חיפוש רחב באתר", "🎟️ קופונים"]);
    // A "searching" note first, as a reply, removed once the answer is ready; the member's
    // message stays.
    const note = calls.find((c) => c.method === "sendMessage")!;
    expect(String(note.payload.text)).toContain("מחפש עבורכם");
    expect(calls.indexOf(note)).toBeLessThan(calls.indexOf(photo));
    const deleted = calls
      .filter((c) => c.method === "deleteMessage")
      .map((c) => c.payload.message_id);
    expect(deleted).toEqual([101]);
    // Every line right to left, and the model's short name and description.
    const caption = String(photo.payload.caption);
    for (const line of caption.split("\n").filter(Boolean)) expect(line.startsWith("‏")).toBe(true);
    expect(caption).toContain("אוהל קל לשניים");
    expect(caption).toContain("אוהל עמיד למים עם מוטות אלומיניום.");
  });

  it("deletes a message that is not a search, after a short note", async () => {
    const { deps, calls } = setup({ isProductSearch: async () => false });
    await handleUpdate(groupMessage("מישהו הזמין פעם מאלי?"), deps);
    expect(deps.sleep).toHaveBeenCalledWith(NOTE_MS);
    const deleted = calls
      .filter((c) => c.method === "deleteMessage")
      .map((c) => c.payload.message_id);
    expect(deleted).toEqual([55, 101]);
    expect(calls.some((c) => c.method === "sendPhoto")).toBe(false);
  });

  it("never asks the model about what the free rules reject", async () => {
    const isProductSearch = vi.fn(async () => true);
    const { deps } = setup({ isProductSearch });
    await handleUpdate(groupMessage("https://spam.example"), deps);
    await handleUpdate(groupMessage(undefined, { caption: "photo" }), deps);
    expect(isProductSearch).not.toHaveBeenCalled();
  });

  it("stops at the daily limit without searching", async () => {
    const search = vi.fn();
    const { deps, calls } = setup({
      withinLimit: async (counter) => counter !== "search",
      search,
    });
    await handleUpdate(groupMessage("אוזניות"), deps);
    expect(search).not.toHaveBeenCalled();
    expect(String(calls[0]!.payload.text)).toContain("חיפושים של היום");
  });

  it("sends the answer as text when the collage cannot be drawn", async () => {
    const { deps, calls } = setup({ collage: async () => null });
    await handleUpdate(groupMessage("אוזניות"), deps);
    expect(calls.some((c) => c.method === "sendPhoto")).toBe(false);
    const texts = calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => String(c.payload.text));
    expect(texts.at(-1)).toContain("🥇");
  });

  it("ignores other chats and bots, and records where the bot was added", async () => {
    const { deps, calls } = setup();
    await handleUpdate(groupMessage("אוזניות", { chat: { id: -200, type: "supergroup" } }), deps);
    await handleUpdate(groupMessage("אוזניות", { from: { id: 9, is_bot: true } }), deps);
    expect(calls).toEqual([]);
    await handleUpdate(
      {
        update_id: 2,
        my_chat_member: {
          chat: { id: -300, type: "supergroup", title: "חדשה" },
          new_chat_member: { status: "administrator", user: { id: 1 } },
        },
      },
      deps,
    );
    expect(deps.noteChat).toHaveBeenCalledWith({
      id: "-300",
      title: "חדשה",
      type: "supergroup",
      status: "administrator",
    });
  });

  it("records a group it never heard of from any message there, with the bot's status", async () => {
    const { deps } = setup({ knownChat: async () => false, searchChatId: async () => null });
    await handleUpdate(
      groupMessage("שלום", { chat: { id: -500, type: "supergroup", title: "חיפושים" } }),
      deps,
    );
    expect(deps.noteChat).toHaveBeenCalledWith({
      id: "-500",
      title: "חיפושים",
      type: "supergroup",
      status: "administrator",
    });
  });

  it("answers the coupons button in the chat", async () => {
    const { deps, calls } = setup();
    await handleUpdate(
      {
        update_id: 3,
        callback_query: {
          id: "cb",
          from: { id: 7 },
          data: "coupons",
          message: { message_id: 90, date: 1, chat: { id: -100, type: "supergroup" } },
        },
      },
      deps,
    );
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "sendMessage"]);
    expect(calls[1]!.payload.text).toBe("<b>קופונים</b>");
  });
});

describe("the short names and lines", () => {
  it("keeps a Hebrew name and line whose numbers the title has", async () => {
    const { checkDescribed } = await import("./describe");
    expect(
      checkDescribed(
        { name_he: "ריסים מגנטיים 14 זוגות", line_he: "ערכת ריסים רכים למראה טבעי." },
        "14/10/7/5 Pairs Magnetic Eyelashes Natural Soft",
      ),
    ).toEqual({ name: "ריסים מגנטיים 14 זוגות", line: "ערכת ריסים רכים למראה טבעי." });
  });
  it("drops an invented number, a price or praise, and English-only text", async () => {
    const { checkDescribed } = await import("./describe");
    const title = "Magnetic Eyelashes Natural Soft";
    expect(checkDescribed({ name_he: "ריסים 20 זוגות", line_he: "" }, title)).toBeNull();
    expect(checkDescribed({ name_he: "Magnetic lashes", line_he: "" }, title)).toBeNull();
    expect(
      checkDescribed({ name_he: "ריסים מגנטיים", line_he: "הריסים הכי טובים במחיר מעולה" }, title),
    ).toEqual({ name: "ריסים מגנטיים", line: null });
  });
});
