import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const create = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: () => ({ parse: (text: string) => JSON.parse(text) }),
}));

import { AnthropicProvider } from "./anthropic";

const response = {
  stop_reason: "end_turn",
  content: [{ type: "text", text: '{"ok":true}' }],
  usage: { input_tokens: 10, output_tokens: 2 },
  model: "claude-haiku-4-5",
};

describe("AnthropicProvider", () => {
  it("passes a request's time limit and retries as request options, and nothing otherwise", async () => {
    create.mockResolvedValue(response);
    const llm = new AnthropicProvider("key", "claude-haiku-4-5");
    const req = { system: "s", user: "u", schema: z.object({ ok: z.boolean() }), maxTokens: 50 };
    const res = await llm.generateStructured({ ...req, timeoutMs: 10_000, maxRetries: 0 });
    expect(res.data).toEqual({ ok: true });
    expect(create.mock.calls[0][1]).toEqual({ timeout: 10_000, maxRetries: 0 });
    await llm.generateStructured(req);
    expect(create.mock.calls[1][1]).toEqual({});
  });
});
