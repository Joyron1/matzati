import { describe, expect, it, vi } from "vitest";
import {
  buttonsOf,
  CAPTION_MAX,
  captionOf,
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
    const post = { productId: "1", postHe: "פוסט", photoUrl: "https://ae01.alicdn.com/a.jpg" };
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
});
