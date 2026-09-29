import { describe, expect, it, vi } from "vitest";
import { WhatsAppApiError, WhatsAppClient } from "./client";
import { text } from "./messages";

const config = {
  accessToken: "SECRET-TOKEN-VALUE",
  phoneNumberId: "106540352242922",
  graphVersion: "v25.0",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("WhatsAppClient", () => {
  it("posts a message to the phone number's messages endpoint with the bearer token", async () => {
    const fetchFn = vi.fn(async () => json(200, { messages: [{ id: "wamid.x" }] }));
    await new WhatsAppClient(config, fetchFn as never).send(
      "972501234567",
      text("שלום"),
      "wamid.in",
    );
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v25.0/106540352242922/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer SECRET-TOKEN-VALUE",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972501234567",
      context: { message_id: "wamid.in" },
      type: "text",
      text: { body: "שלום" },
    });
  });

  it("marks a message read with the typing indicator", async () => {
    const fetchFn = vi.fn(async () => json(200, { success: true }));
    await new WhatsAppClient(config, fetchFn as never).markReadTyping("wamid.in");
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.in",
      typing_indicator: { type: "text" },
    });
  });

  it("retries once on a server error, and succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, {}));
    await new WhatsAppClient(config, fetchFn as never).send("972501234567", text("x"));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rejected message, and its error never holds the token", async () => {
    const fetchFn = vi.fn(async () =>
      json(400, { error: { code: 131009, message: "Parameter value is not valid" } }),
    );
    const err = await new WhatsAppClient(config, fetchFn as never)
      .send("972501234567", text("x"))
      .catch((e: unknown) => e);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(WhatsAppApiError);
    expect((err as WhatsAppApiError).code).toBe(131009);
    expect((err as WhatsAppApiError).message).not.toContain("SECRET-TOKEN-VALUE");
  });

  it("turns a network failure into a WhatsAppApiError after one retry", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      new WhatsAppClient(config, fetchFn as never).send("972501234567", text("x")),
    ).rejects.toBeInstanceOf(WhatsAppApiError);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
