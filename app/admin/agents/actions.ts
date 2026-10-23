"use server";
// The admin's agent actions (owner requests 2026-10-19 and 10-23). Each checks requireAdmin()
// itself (an action is reachable by a direct POST) and validates its input with zod. The form
// actions redirect back to /admin/agents with a status the page says; the video actions answer
// the client component that uploads the file.
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import {
  approveCandidate,
  attachVideo,
  rejectCandidate,
  removeVideo,
  rewriteCandidate,
  signedVideoUpload,
} from "@/lib/agents/server";
import { AGENT_MODELS, AGENTS_KEY, agentSettingsSchema } from "@/lib/agents/settings";
import { slotLabel } from "@/lib/agents/schedule";
import { upsertSetting } from "@/lib/settings/db";
import { serviceClient } from "@/lib/supabase/server";

const PAGE = "/admin/agents";

function logError(where: string, err: unknown) {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-agents] ${where}: ${text.slice(0, 300)}`);
}

function back(status: string, extra = ""): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?status=${status}${extra}`);
}

export async function saveAgentSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = agentSettingsSchema.safeParse({
    model: formData.get("model"),
    dailyBudgetUsd: Number(formData.get("dailyBudgetUsd")),
    finderEnabled: formData.get("finderEnabled") === "on",
    telegramEnabled: formData.get("telegramEnabled") === "on",
    // Meta has its own panel (phase 2); kept as they were.
    facebookEnabled: formData.get("facebookEnabled") === "on",
    instagramEnabled: formData.get("instagramEnabled") === "on",
    freeShippingOnly: formData.get("freeShippingOnly") === "on",
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

const decisionSchema = z.object({
  id: z.string().uuid(),
  post: z.string().trim().min(10).max(1000),
});

export async function approveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = decisionSchema.safeParse({ id: formData.get("id"), post: formData.get("post") });
  if (!parsed.success) back("invalid");
  const telegram = formData.get("telegram") === "on";
  let status = "approve-failed";
  let extra = "";
  try {
    const r = await approveCandidate(parsed.data.id, parsed.data.post, telegram);
    if (r.ok) {
      if (!telegram) status = "approved";
      else if (r.telegramAt) {
        status = "approved-scheduled";
        extra = `&at=${encodeURIComponent(slotLabel(r.telegramAt))}`;
      } else status = "approved-telegram-off";
    }
  } catch (err) {
    unstable_rethrow(err);
    logError("approve", err);
  }
  revalidatePath("/recommended");
  back(status, extra);
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

export async function rewriteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  let ok = false;
  try {
    ok = await rewriteCandidate(id.data);
  } catch (err) {
    unstable_rethrow(err);
    logError("rewrite", err);
  }
  back(ok ? "rewritten" : "rewrite-failed", `&open=${id.data}`);
}

// --- The owner's motion video ----------------------------------------------------------------

/** A signed upload URL for one candidate's video; null when the candidate is unknown. */
export async function videoUploadAction(
  candidateId: string,
): Promise<{ path: string; token: string } | null> {
  await requireAdmin();
  if (!z.string().uuid().safeParse(candidateId).success) return null;
  try {
    return await signedVideoUpload(candidateId);
  } catch (err) {
    logError("video upload url", err);
    return null;
  }
}

/** Records the uploaded file on its candidate. */
export async function videoAttachAction(candidateId: string, path: string): Promise<boolean> {
  await requireAdmin();
  if (!z.string().uuid().safeParse(candidateId).success) return false;
  try {
    const ok = await attachVideo(candidateId, path);
    if (ok) revalidatePath(PAGE);
    return ok;
  } catch (err) {
    logError("video attach", err);
    return false;
  }
}

export async function videoRemoveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  try {
    await removeVideo(id.data);
  } catch (err) {
    unstable_rethrow(err);
    logError("video remove", err);
    back("video-failed");
  }
  back("video-removed", `&open=${id.data}`);
}
