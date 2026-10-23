// Download a product's photo or video from AliExpress as a file (owner request 2026-10-23: the
// owner exports them to make a motion video). A browser ignores `download` on another site's
// link, so the file comes through here with Content-Disposition: attachment. Signed-in admins
// only, and only AliExpress's media hosts (lib/agents/media.ts: never an open proxy).
import { getAdminUser } from "@/lib/admin/auth";
import { allowedMediaUrl, mediaFileName } from "@/lib/agents/media";

export async function GET(request: Request): Promise<Response> {
  if (!(await getAdminUser())) return new Response("unauthorized", { status: 401 });
  const params = new URL(request.url).searchParams;
  const url = allowedMediaUrl(params.get("url") ?? "");
  if (!url) return new Response("not allowed", { status: 400 });
  const upstream = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return new Response("not found", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${mediaFileName(params.get("name"), url)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
