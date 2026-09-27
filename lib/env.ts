// Server-side environment access, validated with zod. Never log the values.
import { z } from "zod";

const aliexpressSchema = z.object({
  ALIEXPRESS_APP_KEY: z.string().trim().min(1),
  ALIEXPRESS_APP_SECRET: z.string().trim().min(1),
  ALIEXPRESS_TRACKING_ID: z.string().trim().min(1),
  ALIEXPRESS_GATEWAY: z.string().trim().pipe(z.url()).default("https://api-sg.aliexpress.com/sync"),
});

export interface AliExpressConfig {
  appKey: string;
  appSecret: string;
  trackingId: string;
  gateway: string;
}

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing or invalid environment variables: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

/** Reads AliExpress credentials. Throws ConfigError naming the bad keys (never their values). */
export function aliexpressConfig(source: NodeJS.ProcessEnv = process.env): AliExpressConfig {
  const parsed = aliexpressSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError([...new Set(parsed.error.issues.map((i) => String(i.path[0])))]);
  }
  const env = parsed.data;
  return {
    appKey: env.ALIEXPRESS_APP_KEY,
    appSecret: env.ALIEXPRESS_APP_SECRET,
    trackingId: env.ALIEXPRESS_TRACKING_ID,
    gateway: env.ALIEXPRESS_GATEWAY,
  };
}

const llmSchema = z
  .object({
    LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
    LLM_MODEL: z.string().trim().min(1).default("claude-haiku-4-5-20251001"),
    ANTHROPIC_API_KEY: z.string().trim().optional(),
    OPENAI_API_KEY: z.string().trim().optional(),
  })
  .refine((e) => (e.LLM_PROVIDER === "anthropic" ? !!e.ANTHROPIC_API_KEY : !!e.OPENAI_API_KEY), {
    path: ["API_KEY"],
    message: "API key for the selected LLM_PROVIDER is missing",
  });

export interface LlmConfig {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
}

export function llmConfig(source: NodeJS.ProcessEnv = process.env): LlmConfig {
  const parsed = llmSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError([...new Set(parsed.error.issues.map((i) => String(i.path[0])))]);
  }
  const e = parsed.data;
  const apiKey = (e.LLM_PROVIDER === "anthropic" ? e.ANTHROPIC_API_KEY : e.OPENAI_API_KEY) ?? "";
  return { provider: e.LLM_PROVIDER, model: e.LLM_MODEL, apiKey };
}

const fxSchema = z.object({
  USD_ILS_FALLBACK: z.coerce.number().positive().default(3.05),
});

export function usdIlsFallback(source: NodeJS.ProcessEnv = process.env): number {
  return fxSchema.parse(source).USD_ILS_FALLBACK;
}
