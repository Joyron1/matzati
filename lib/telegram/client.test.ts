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

  it("sends every photo and video as one album, the caption on the first, the link direct", async () => {
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true, result: [{ message_id: 7 }, { message_id: 8 }] })),
    );
    const config = { token: "T", chatId: "@c" };
    const r = await postProduct(
      config,
      {
        productId: "1",
        postHe: "שורה\n🔗 קישור לקנייה",
        buyUrl: "https://s.click.aliexpress.com/e/_abc",
        photos: [
          "https://ae01.alicdn.com/1.jpg",
          "https://ae01.alicdn.com/2.jpg",
          "https://ae01.alicdn.com/1.jpg",
        ],
        videos: ["https://video.aliexpress-media.com/v.mp4"],
      },
      send,
    );
    expect(r).toEqual({ ok: true, messageId: "7" });
    expect(String(send.mock.calls[0][0])).toMatch(/\/sendMediaGroup$/);
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body.media.map((m: { type: string }) => m.type)).toEqual(["video", "photo", "photo"]);
    // A short link text on the 🔗 line, never the bare URL (owner request 2026-10-27).
    expect(body.media[0].caption).toContain(
      '🔗 <a href="https://s.click.aliexpress.com/e/_abc">לקנייה באלי אקספרס ←</a>',
    );
    expect(body.media[0].caption).not.toContain("לקנייה: https");
    expect(body.media[0].caption).not.toContain("/go/");
    expect(body.media[1].caption).toBeUndefined();
  });

  it("falls back to the photos only, then to one photo, when Telegram refuses the album", async () => {
    const calls: string[] = [];
    const send = vi.fn<typeof fetch>(async (url, init) => {
      const method = String(url).split("/").pop()!;
      const media = JSON.parse(String(init?.body)).media as { type: string }[] | undefined;
      calls.push(`${method}:${media ? media.length : 1}`);
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
    expect(calls).toEqual(["sendMediaGroup:3", "sendMediaGroup:2", "sendPhoto:1"]);
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
