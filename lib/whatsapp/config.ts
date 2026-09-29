// WhatsApp Cloud API settings, read from the environment. Never log the values.
// The bot is off until all four secrets are set: the webhook answers 404 without them.
import { z } from "zod";
import { ConfigError } from "@/lib/env";

const schema = z.object({
  WHATSAPP_ACCESS_TOKEN: z.string().trim().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/),
  // The string typed into Meta's webhook setup; echoed back on the GET verification.
  WHATSAPP_VERIFY_TOKEN: z.string().trim().min(8),
  // The Meta app secret: the key of the X-Hub-Signature-256 HMAC on every POST.
  WHATSAPP_APP_SECRET: z.string().trim().min(8),
  // Meta's docs examples use v25.0 (checked 2026-09-29); overridable without a deploy.
  WHATSAPP_GRAPH_VERSION: z
    .string()
    .trim()
    .regex(/^v\d{1,3}\.\d{1,2}$/)
    .default("v25.0"),
});

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
  graphVersion: string;
}

/** True when every required key is set (the webhook is live only then). */
export function whatsappEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return schema.safeParse(source).success;
}

/** Reads the settings. Throws ConfigError naming the bad keys (never their values). */
export function whatsappConfig(source: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError([...new Set(parsed.error.issues.map((i) => String(i.path[0])))]);
  }
  const e = parsed.data;
  return {
    accessToken: e.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: e.WHATSAPP_VERIFY_TOKEN,
    appSecret: e.WHATSAPP_APP_SECRET,
    graphVersion: e.WHATSAPP_GRAPH_VERSION,
  };
}
