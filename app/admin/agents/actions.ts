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
  publishNow,
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
    minPriceIls: Number(formData.get("minPriceIls") ?? 20),
  });
  if (!parsed.success || !AGENT_MODELS.some((m) => m.id === parsed.data.model))
    back("invalid", "&tab=settings");
  try {
    await upsertSetting(serviceClient(), AGENTS_KEY, parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    logError("save settings", err);
    back("save-failed", "&tab=settings");
  }
  back("saved", "&tab=settings");
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

/** "פרסום עכשיו": approve if needed and post to Telegram at once, ignoring slots and quiet time. */
export async function publishNowAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  const post = z.string().trim().min(1).max(1000).safeParse(formData.get("post"));
  let status = "publish-failed";
  let extra = "";
  try {
    const r = await publishNow(id.data, post.success ? post.data : undefined);
    if (r.ok) status = "published-now";
    else if (r.reason === "not-connected") status = "publish-not-connected";
    else if (r.reason === "already") status = "publish-already";
    else if (r.error) extra = `&err=${encodeURIComponent(r.error.slice(0, 200))}`;
  } catch (err) {
    unstable_rethrow(err);
    logError("publish now", err);
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

// --- The search group and the weekly poll (owner requests 2026-10-25) ----------------------------

const GROUP = "&tab=group";

export async function connectWebhookAction(): Promise<void> {
  await requireAdmin();
  const { connectWebhook } = await import("@/lib/telegram/group/server");
  const r = await connectWebhook();
  if (!r.ok) {
    logError("webhook", r.error);
    back("webhook-failed", `${GROUP}&err=${encodeURIComponent((r.error ?? "").slice(0, 120))}`);
  }
  back("webhook-connected", GROUP);
}

export async function chooseSearchGroupAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z
    .string()
    .regex(/^-?\d{1,20}$/)
    .safeParse(formData.get("chatId"));
  if (!id.success) back("invalid", GROUP);
  try {
    const { readGroupSettings, saveGroupSettings } = await import("@/lib/telegram/group/store");
    const s = await readGroupSettings();
    const chat = s.seen.find((c) => c.id === id.data);
    await saveGroupSettings({ searchChatId: id.data, searchChatTitle: chat?.title ?? null });
  } catch (err) {
    unstable_rethrow(err);
    logError("group", err);
    back("save-failed", GROUP);
  }
  back("group-chosen", GROUP);
}

export async function saveGroupSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = z
    .object({ dailyLimit: z.number().int().min(1).max(100), pollEnabled: z.boolean() })
    .safeParse({
      dailyLimit: Number(formData.get("dailyLimit")),
      pollEnabled: formData.get("pollEnabled") === "on",
    });
  if (!parsed.success) back("invalid", GROUP);
  try {
    const { saveGroupSettings } = await import("@/lib/telegram/group/store");
    await saveGroupSettings(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    logError("group settings", err);
    back("save-failed", GROUP);
  }
  back("saved", GROUP);
}

export async function sendPollNowAction(): Promise<void> {
  await requireAdmin();
  const { sendPoll } = await import("@/lib/telegram/group/server");
  const r = await sendPoll();
  if (!r.ok) {
    logError("poll", r.error);
    back("poll-failed", `${GROUP}&err=${encodeURIComponent((r.error ?? "").slice(0, 120))}`);
  }
  back("poll-sent", GROUP);
}

// --- Many at once (owner request 2026-10-27) -------------------------------------------------------

const idsSchema = z.array(z.string().uuid()).min(1).max(60);

/** Approves every selected pending candidate with its post as written, scheduled to Telegram. */
export async function bulkApproveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const ids = idsSchema.safeParse(formData.getAll("ids"));
  if (!ids.success) back("bulk-none");
  const telegram = formData.get("telegram") === "on";
  let done = 0;
  try {
    const { getCandidate } = await import("@/lib/agents/store");
    // One after another: each goes to the end of the Telegram queue.
    for (const id of ids.data) {
      const c = await getCandidate(serviceClient(), id);
      if (!c || c.status !== "pending") continue;
      const r = await approveCandidate(id, c.post_he, telegram);
      if (r.ok) done++;
    }
  } catch (err) {
    unstable_rethrow(err);
    logError("bulk approve", err);
  }
  revalidatePath("/recommended");
  back(done ? "bulk-approved" : "approve-failed", `&n=${done}`);
}

/** Marks every selected pending candidate as not suitable (never proposed again). */
export async function bulkRejectAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const ids = idsSchema.safeParse(formData.getAll("ids"));
  if (!ids.success) back("bulk-none");
  let done = 0;
  try {
    for (const id of ids.data) {
      await rejectCandidate(id);
      done++;
    }
  } catch (err) {
    unstable_rethrow(err);
    logError("bulk reject", err);
  }
  back(done ? "bulk-rejected" : "reject-failed", `&n=${done}`);
}
