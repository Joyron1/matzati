// The Telegram bot's webhook (owner requests 2026-10-25: the search group, the coupons button, the
// weekly poll's counts, the owner's linking code). Telegram sends the secret set by setWebhook in
// X-Telegram-Bot-Api-Secret-Token; anything else is refused. Answers 200 at once and works in
// after(): a search takes 10-25 s and a note waits 12 s before it is deleted, while Telegram
// re-sends an update it did not get a quick answer for.
import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { webhookSecret } from "@/lib/telegram/api";
import { telegramConfig } from "@/lib/telegram/client";
import { handleUpdate, type TgUpdate } from "@/lib/telegram/group/handle";
import { groupDeps } from "@/lib/telegram/group/server";

export const maxDuration = 60;

function sameSecret(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(request: Request): Promise<Response> {
  const config = telegramConfig();
  if (!config) return new Response("not found", { status: 404 });
  if (
    !sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), webhookSecret(config.token))
  ) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  const deps = groupDeps();
  if (update && typeof update.update_id === "number" && deps) {
    after(() => handleUpdate(update, deps));
  }
  return new Response("ok");
}
