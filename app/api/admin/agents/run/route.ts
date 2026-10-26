// The admin's "הרצה עכשיו" (owner request 2026-10-23: a progress bar while it runs): POST runs the
// product finder and answers with its result; GET answers with the newest run's progress, which
// the page polls every second meanwhile (agent_runs.progress and stage, written by the run).
// Signed-in admins only.
import { getAdminUser } from "@/lib/admin/auth";
import { runFinderFor } from "@/lib/agents/server";
import { CATALOG } from "@/lib/catalog/categories";
import { listRuns } from "@/lib/agents/store";
import { serviceClient } from "@/lib/supabase/server";

// Eight hot lists 1.1 s apart, two AliExpress calls and one writer call (up to 45 s).
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  if (!(await getAdminUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  // An optional catalog category to limit the run to (owner request 2026-10-27).
  const body = (await request.json().catch(() => null)) as { category?: unknown } | null;
  const key = typeof body?.category === "string" ? body.category : "";
  const category = CATALOG.some((c) => c.key === key) ? key : undefined;
  const result = await runFinderFor("admin", category);
  return Response.json(result, { headers: noStore });
}

export async function GET(): Promise<Response> {
  if (!(await getAdminUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [run] = await listRuns(serviceClient(), 1);
  return Response.json(
    run
      ? { status: run.status, progress: run.progress, stage: run.stage, started_at: run.started_at }
      : { status: "none", progress: 0, stage: null },
    { headers: noStore },
  );
}
