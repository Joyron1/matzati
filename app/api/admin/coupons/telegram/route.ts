// The admin's "שליחת הקופונים לטלגרם" on /coupons (owner request 2026-11-01). GET: whether the
// visitor is a signed-in admin and, if so, the message as it would go out (a plain-text preview)
// and whether the channel is configured; the button asks only when the admin hint cookie is set
// (components/admin-coupons-telegram.tsx), so visitors never call it. POST: sends it to the
// channel (TELEGRAM_CHAT_ID) with two buttons. Signed-in admins only; never cached.
import { getAdminUser } from "@/lib/admin/auth";
import { absoluteUrl } from "@/lib/config/site";
import { listPublicCoupons } from "@/lib/coupons/queries";
import { couponsForPost, couponsMessage, MESSAGE_MAX, plainPreview } from "@/lib/coupons/telegram";
import { homeAffiliateLink } from "@/lib/search/server";
import { tg } from "@/lib/telegram/api";
import { telegramConfig } from "@/lib/telegram/client";

export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };

type Built =
  { ok: true; text: string; buyUrl: string; count: number } | { ok: false; reason: string };

async function build(): Promise<Built> {
  const now = new Date();
  const { active } = await listPublicCoupons(now);
  const coupons = couponsForPost(active, now);
  if (coupons.length === 0) return { ok: false, reason: "empty" };
  const buyUrl = await homeAffiliateLink();
  const text = couponsMessage(coupons, { buyUrl, pageUrl: absoluteUrl("/coupons") });
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MESSAGE_MAX) return { ok: false, reason: "too-long" };
  return { ok: true, text, buyUrl, count: coupons.length };
}

export async function GET(): Promise<Response> {
  if (!(await getAdminUser())) return Response.json({ admin: false }, { headers: noStore });
  try {
    const built = await build();
    return Response.json(
      {
        admin: true,
        connected: telegramConfig() !== null,
        ...(built.ok
          ? { preview: plainPreview(built.text), count: built.count }
          : { reason: built.reason }),
      },
      { headers: noStore },
    );
  } catch (err) {
    console.error(`[coupons-telegram] ${String(err).slice(0, 300)}`);
    return Response.json({ admin: true, reason: "failed" }, { headers: noStore });
  }
}

export async function POST(): Promise<Response> {
  if (!(await getAdminUser())) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const config = telegramConfig();
  if (!config) return Response.json({ ok: false, reason: "not-connected" }, { headers: noStore });
  try {
    const built = await build();
    if (!built.ok) return Response.json({ ok: false, reason: built.reason }, { headers: noStore });
    const sent = await tg(config, "sendMessage", {
      chat_id: config.chatId,
      text: built.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛒 לקנייה באלי אקספרס", url: built.buyUrl }],
          [{ text: "🎟️ כל הקופונים באתר", url: absoluteUrl("/coupons") }],
        ],
      },
    });
    if (!sent.ok) {
      console.error(`[coupons-telegram] ${sent.error}`);
      return Response.json({ ok: false, reason: "telegram" }, { headers: noStore });
    }
    return Response.json({ ok: true, count: built.count }, { headers: noStore });
  } catch (err) {
    console.error(`[coupons-telegram] ${String(err).slice(0, 300)}`);
    return Response.json({ ok: false, reason: "failed" }, { status: 500, headers: noStore });
  }
}
