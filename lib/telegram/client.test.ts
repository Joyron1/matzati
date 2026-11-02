import { describe, expect, it, vi } from "vitest";
import {
  buttonsOf,
  CAPTION_MAX,
  captionOf,
  albumItems,
  postProduct,
  TELEGRAM_DISCLOSURE,
  telegramConfig,
} from "./client";

describe("telegram client", () => {
  it("is off until both variables are set", () => {
    expect(telegramConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: "t" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      telegramConfig({
        TELEGRAM_BOT_TOKEN: " t ",
        TELEGRAM_CHAT_ID: "@c",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ token: "t", chatId: "@c" });
  });

  it("escapes the post, adds the disclosure, and stays within Telegram's limit", () => {
    const caption = captionOf("מחיר <b>טוב</b> & זול");
    expect(caption).toContain("מחיר &lt;b&gt;טוב&lt;/b&gt; &amp; זול");
    expect(caption).toContain(TELEGRAM_DISCLOSURE);
    expect(captionOf("א".repeat(5000)).length).toBeLessThanOrEqual(CAPTION_MAX);
  });

  it("buys through /go with src=telegram and links our product page", () => {
    const urls = buttonsOf("1005001")
      .inline_keyboard.flat()
      .map((b) => b.url);
    expect(urls).toEqual([
      "https://www.matzati-il.com/go/1005001?src=telegram",
      "https://www.matzati-il.com/p/1005001",
    ]);
  });

  it("returns the message id, or the reason without the token", async () => {
    const ok = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })),
    );
    const config = { token: "SECRET-TOKEN", chatId: "@c" };
    const post = {
      productId: "1",
      postHe: "פוסט",
      buyUrl: "https://s.click.aliexpress.com/e/_abc",
      photos: ["https://ae01.alicdn.com/a.jpg"],
      videos: [],
    };
    await expect(postProduct(config, post, ok)).resolves.toEqual({ ok: true, messageId: "42" });
    const body = JSON.parse(String(ok.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ chat_id: "@c", parse_mode: "HTML" });

    const refused = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), {
          status: 400,
        }),
    );
    const r = await postProduct(config, post, refused);
    expect(r).toEqual({ ok: false, error: "Telegram 400: Bad Request: chat not found" });

    const broken = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed for https://api.telegram.org/botSECRET-TOKEN/sendPhoto");
    });
    const failed = await postProduct(config, post, broken);
    expect(JSON.stringify(failed)).not.toContain("SECRET-TOKEN");
  });

  it("sends one message: the main photo with the post and its buttons", async () => {
    const send = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true, result: { message_id: 9 } })),
    );
    const config = { token: "T", chatId: "@c" };
    const r = await postProduct(
      config,
      {
        productId: "1",
        postHe:
          "מחיר מטורף!!!\n\n💰 מחיר: ₪1381\n🎟️ קוד קופון: ILAFF60 · US$60 הנחה\n💰 מחיר סופי עם הקופון: כ־₪1189\n🔗 קישור לקנייה",
        buyUrl: "https://s.click.aliexpress.com/e/_abc",
        photos: ["https://ae01.alicdn.com/1.jpg", "https://ae01.alicdn.com/2.jpg"],
        videos: [],
      },
      send,
    );
    expect(r).toEqual({ ok: true, messageId: "9" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0][0])).toMatch(/\/sendPhoto$/);
    const msg = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(msg.photo).toBe("https://ae01.alicdn.com/1.jpg");
    // A short link text on the 🔗 line, never the bare URL (owner request 2026-10-27).
    expect(msg.caption).toContain(
      '🔗 <a href="https://s.click.aliexpress.com/e/_abc">לקנייה באלי אקספרס ←</a>',
    );
    expect(msg.caption).not.toContain("/go/");
    expect(msg.caption).toContain("<b>מחיר מטורף!!!</b>");
    expect(msg.caption).toContain("קוד קופון: <code>ILAFF60</code>");
    expect(msg.caption).toContain("<b>💰 מחיר סופי עם הקופון: כ־₪1189</b>");
    expect(msg.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "לקנייה באלי אקספרס",
      url: "https://s.click.aliexpress.com/e/_abc",
    });
  });

  it("leads with the owner's video, and sends the main photo when Telegram refuses it", async () => {
    const calls: string[] = [];
    const send = vi.fn<typeof fetch>(async (url) => {
      const method = String(url).split("/").pop()!;
      calls.push(method);
      if (method === "sendPhoto")
        return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }));
      return new Response(
        JSON.stringify({ ok: false, description: "Bad Request: failed to get HTTP URL content" }),
        { status: 400 },
      );
    });
    const r = await postProduct(
      { token: "T", chatId: "@c" },
      {
        productId: "1",
        postHe: "פוסט",
        buyUrl: "https://s.click.aliexpress.com/e/_abc",
        photos: ["https://ae01.alicdn.com/1.jpg", "https://ae01.alicdn.com/2.jpg"],
        videos: ["https://video.aliexpress-media.com/v.mp4"],
      },
      send,
    );
    expect(calls).toEqual(["sendVideo", "sendPhoto"]);
    expect(r).toEqual({ ok: true, messageId: "9" });
  });

  it("keeps at most 10 items, videos first", () => {
    const items = albumItems({
      videos: ["https://v/1.mp4"],
      photos: Array.from({ length: 12 }, (_, i) => `https://p/${i}.jpg`),
    });
    expect(items).toHaveLength(10);
    expect(items[0]).toEqual({ type: "video", media: "https://v/1.mp4" });
  });
});
