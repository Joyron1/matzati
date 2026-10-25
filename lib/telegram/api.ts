// A Telegram Bot API call for the group bot, the webhook and the weekly poll (owner requests
// 2026-10-25). JSON, or multipart when a file is attached (the collage is sent as bytes, never
// stored). The token is only in the URL path, as Telegram requires, and never logged or returned:
// a failure is Telegram's description or the network error's name.
import { createHash } from "node:crypto";
import type { TelegramConfig } from "./client";

export type TgResult<T> = { ok: true; result: T } | { ok: false; error: string; status: number };

export async function tg<T = unknown>(
  config: Pick<TelegramConfig, "token">,
  method: string,
  payload: Record<string, unknown>,
  opts: { file?: { field: string; name: string; blob: Blob }; fetchImpl?: typeof fetch } = {},
): Promise<TgResult<T>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let body: BodyInit;
  const headers: Record<string, string> = {};
  if (opts.file) {
    const form = new FormData();
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue;
      form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    form.append(opts.file.field, opts.file.blob, opts.file.name);
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;
    if (res.ok && json?.ok) return { ok: true, result: json.result as T };
    return {
      ok: false,
      status: res.status,
      error: `Telegram ${res.status}: ${json?.description ?? "no answer"}`.slice(0, 300),
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.name : "network error" };
  }
}

/**
 * The webhook's secret (setWebhook secret_token, sent back in X-Telegram-Bot-Api-Secret-Token):
 * derived from the bot token, so no new variable is needed and nobody without the token can call
 * the webhook. 1-256 characters of A-Z, a-z, 0-9, _ and -.
 */
export function webhookSecret(token: string): string {
  return createHash("sha256").update(`matzati-tg-webhook:${token}`).digest("hex").slice(0, 48);
}
