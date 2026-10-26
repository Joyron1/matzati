// The admin's "הוספה למומלצים" on a product page (owner request 2026-10-27). GET: whether the
// visitor is a signed-in admin and where the product stands (none, pending, approved, posted); the
// button asks only when the admin hint cookie is set (components/admin-recommend.tsx), so visitors
// never call it. POST: adds the product to "המומלצים שלנו" and posts it to the Telegram channel
// (recommendNow). Signed-in admins only; never cached.
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import { recommendNow } from "@/lib/agents/server";
import { getCandidateByProduct } from "@/lib/agents/store";
import { serviceClient } from "@/lib/supabase/server";

// productdetail.get, one writer call and the Telegram album (up to about 40 s).
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
const productId = z.string().regex(/^\d{6,20}$/);

export async function GET(request: Request): Promise<Response> {
  if (!(await getAdminUser())) return Response.json({ admin: false }, { headers: noStore });
  const id = productId.safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ admin: true, state: "none" }, { headers: noStore });
  const c = await getCandidateByProduct(serviceClient(), id.data).catch(() => null);
  const state = !c
    ? "none"
    : c.telegram_posted_at
      ? "posted"
      : c.status === "approved"
        ? "approved"
        : c.status === "pending"
          ? "pending"
          : "rejected";
  return Response.json({ admin: true, state }, { headers: noStore });
}

export async function POST(request: Request): Promise<Response> {
  if (!(await getAdminUser())) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const body = (await request.json().catch(() => null)) as { productId?: unknown } | null;
  const id = productId.safeParse(body?.productId);
  if (!id.success) return Response.json({ error: "invalid" }, { status: 400, headers: noStore });
  try {
    return Response.json(await recommendNow(id.data), { headers: noStore });
  } catch (err) {
    console.error(`[recommend] ${String(err).slice(0, 300)}`);
    return Response.json({ ok: false, reason: "failed" }, { status: 500, headers: noStore });
  }
}
