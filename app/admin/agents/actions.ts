"use server";
// The admin's agent actions (owner request 2026-10-19). Each checks requireAdmin() itself (an
// action is reachable by a direct POST), validates its form with zod and redirects back to
// /admin/agents with a status the page says.
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { approveCandidate, rejectCandidate, runFinderFor } from "@/lib/agents/server";
import { AGENT_MODELS, AGENTS_KEY, agentSettingsSchema } from "@/lib/agents/settings";
import { upsertSetting } from "@/lib/settings/db";
import { serviceClient } from "@/lib/supabase/server";

const PAGE = "/admin/agents";

function logError(where: string, err: unknown) {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-agents] ${where}: ${text.slice(0, 300)}`);
}

function back(status: string): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?status=${status}`);
}

export async function saveAgentSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = agentSettingsSchema.safeParse({
    model: formData.get("model"),
    dailyBudgetUsd: Number(formData.get("dailyBudgetUsd")),
    finderEnabled: formData.get("finderEnabled") === "on",
    telegramEnabled: formData.get("telegramEnabled") === "on",
    facebookEnabled: formData.get("facebookEnabled") === "on",
    instagramEnabled: formData.get("instagramEnabled") === "on",
  });
  if (!parsed.success || !AGENT_MODELS.some((m) => m.id === parsed.data.model)) back("invalid");
  try {
    await upsertSetting(serviceClient(), AGENTS_KEY, parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    logError("save settings", err);
    back("save-failed");
  }
  back("saved");
}

export async function runFinderAction(): Promise<void> {
  await requireAdmin();
  let status = "run-failed";
  try {
    const r = await runFinderFor("admin");
    status = r.status === "failed" ? "run-failed" : `run-${r.added}`;
  } catch (err) {
    unstable_rethrow(err);
    logError("run", err);
  }
  back(status);
}

const decisionSchema = z.object({
  id: z.string().uuid(),
  post: z.string().trim().min(10).max(1000),
});

export async function approveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = decisionSchema.safeParse({ id: formData.get("id"), post: formData.get("post") });
  if (!parsed.success) back("invalid");
  const channels = {
    telegram: formData.get("telegram") === "on",
    facebook: formData.get("facebook") === "on",
    instagram: formData.get("instagram") === "on",
  };
  let status = "approve-failed";
  try {
    const r = await approveCandidate(parsed.data.id, parsed.data.post, channels);
    const answers = [r.telegram, r.facebook, r.instagram].filter((a) => a !== undefined);
    status = !r.ok
      ? "approve-failed"
      : !answers.length
        ? "approved"
        : answers.some((a) => a !== "off" && !a.ok)
          ? "approved-channel-failed"
          : answers.some((a) => a === "off")
            ? "approved-channel-off"
            : "approved-channels";
  } catch (err) {
    unstable_rethrow(err);
    logError("approve", err);
  }
  revalidatePath("/recommended");
  back(status);
}

export async function rejectAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  try {
    await rejectCandidate(id.data);
  } catch (err) {
    unstable_rethrow(err);
    logError("reject", err);
    back("reject-failed");
  }
  revalidatePath("/recommended");
  back("rejected");
}
