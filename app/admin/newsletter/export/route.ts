// "ייצוא CSV" on /admin/newsletter: every active subscriber as a CSV file (lib/newsletter/csv.ts:
// UTF-8 with a BOM for Excel, every field quoted, formula cells neutralized). Admins only: route
// handlers do not pass through the admin layout, so this checks requireAdmin() itself (a signed-out
// request is redirected to the sign-in). Never cached anywhere.
import { requireAdmin } from "@/lib/admin/auth";
import { exportActiveSubscribers } from "@/lib/newsletter/admin";

const NO_STORE = "private, no-store, max-age=0";

export async function GET() {
  await requireAdmin();
  try {
    const { body, fileName } = await exportActiveSubscribers(new Date());
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": NO_STORE,
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    // Name and message only, never rows.
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-newsletter] export: ${text.slice(0, 300)}`);
    return new Response("לא הצלחנו להכין את הקובץ. נסו שוב בעוד רגע.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE },
    });
  }
}
