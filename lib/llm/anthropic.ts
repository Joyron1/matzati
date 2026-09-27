import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { LlmProvider, StructuredRequest, StructuredResult } from "./provider";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    options: { maxRetries?: number } = {},
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: options.maxRetries ?? 2, timeout: 20_000 });
  }

  async generateStructured<T extends z.ZodType>(
    req: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const format = zodOutputFormat(req.schema);
    // create() rather than parse(): parse() throws on output that does not validate (for example
    // JSON cut off at max_tokens), which would lose the usage we paid for and skip the caller's
    // retry. The interface promises data: null instead.
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: { format },
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });
    const u = response.usage;
    return {
      data: response.stop_reason === "end_turn" ? parseText(format, response.content) : null,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
      model: response.model,
    };
  }
}

function parseText<T>(
  format: { parse: (content: string) => T },
  content: Anthropic.ContentBlock[],
): T | null {
  const block = content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block) return null;
  try {
    return format.parse(block.text);
  } catch {
    return null;
  }
}
