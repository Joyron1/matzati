// Provider-agnostic LLM interface (CLAUDE.md §3). The LLM only parses queries and explains
// results; it never searches, filters or ranks.
import type { z } from "zod";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StructuredRequest<T extends z.ZodType> {
  system: string;
  user: string;
  schema: T;
  maxTokens: number;
  /** Omitted means the provider default. Claude Haiku 4.5 accepts it; newer Opus, Sonnet and
   * Fable models reject sampling parameters, so revisit callers before changing LLM_MODEL. */
  temperature?: number;
  /** Time limit for one attempt, in ms; omitted means the provider default. */
  timeoutMs?: number;
  /** Retries of a failed attempt (network, timeout, 5xx, rate limit); omitted means the default. */
  maxRetries?: number;
}

export interface StructuredResult<T> {
  /** Null when the model's output did not match the schema. */
  data: T | null;
  usage: LlmUsage;
  model: string;
}

export interface LlmProvider {
  readonly name: "anthropic" | "openai";
  readonly model: string;
  generateStructured<T extends z.ZodType>(
    req: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>>;
}
