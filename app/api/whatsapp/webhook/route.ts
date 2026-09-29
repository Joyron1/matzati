// The WhatsApp Cloud API webhook (docs/whatsapp-bot.md).
//   GET  Meta's one-time verification when the webhook is set up in the app dashboard.
//   POST every user message. Verified against X-Hub-Signature-256 on the raw body, answered 200 at
//        once (Meta retries slow answers for up to 36 hours), and handled after the response with
//        after(): a fresh search takes 10-25 s, the limit is maxDuration.
// Off (404) until the four WHATSAPP_* secrets are set, so deploying this code changes nothing.
import { after } from "next/server";
import { listPublicCoupons } from "@/lib/coupons/queries";
import { nextSale } from "@/lib/deals/queries";
import { hotCarouselProducts } from "@/lib/hot/queries";
import { moreForRequest, searchForRequest } from "@/lib/search/server";
import { serviceClient } from "@/lib/supabase/server";
import { handleIncoming, type BotDeps } from "@/lib/whatsapp/bot";
import { WhatsAppClient } from "@/lib/whatsapp/client";
import { whatsappConfig, whatsappEnabled } from "@/lib/whatsapp/config";
import { inboundMessages } from "@/lib/whatsapp/inbound";
import { SupabaseSessionStore } from "@/lib/whatsapp/session";
import { verifySignature } from "@/lib/whatsapp/signature";

export const maxDuration = 60;

const notFound = () => new Response("Not found", { status: 404 });

export function GET(request: Request) {
  if (!whatsappEnabled()) return notFound();
  const params = new URL(request.url).searchParams;
  const { verifyToken } = whatsappConfig();
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken) {
    return new Response(params.get("hub.challenge") ?? "", {
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

function botDeps(config: ReturnType<typeof whatsappConfig>): BotDeps {
  const salt = process.env.IP_HASH_SALT?.trim();
  if (!salt) throw new Error("IP_HASH_SALT is not set");
  return {
    sender: new WhatsAppClient(config),
    sessions: new SupabaseSessionStore(serviceClient()),
    salt,
    search: (input, headers) => searchForRequest(input, headers),
    more: (filtersKey, page, headers) => moreForRequest(filtersKey, page, headers),
    hot: () => hotCarouselProducts(),
    coupons: async (now) => (await listPublicCoupons(now)).active,
    nextSale,
    now: () => new Date(),
    // Name and message only: no stack traces, and our errors never carry secret values.
    log: (where, err) =>
      console.error(
        `[${where}] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(
          0,
          500,
        ),
      ),
  };
}

export async function POST(request: Request) {
  if (!whatsappEnabled()) return notFound();
  const config = whatsappConfig();
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const messages = inboundMessages(payload, config.phoneNumberId);
  if (messages.length) {
    const deps = botDeps(config);
    after(async () => {
      // One after another: a user's messages are answered in the order they were sent.
      for (const message of messages) await handleIncoming(message, deps);
    });
  }
  return new Response("ok");
}
