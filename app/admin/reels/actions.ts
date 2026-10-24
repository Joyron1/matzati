"use server";

// The Reels panel's actions (owner request 2026-10-24). Every action checks requireAdmin() first.
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { isQuietTime } from "@/lib/agents/schedule";
import { META_DISCLOSURE } from "@/lib/meta/publish";
import { cancelReel, insertReel, signedReelUpload } from "@/lib/meta/reels-server";
import { fromIsraelLocal, REEL_MIN_LEAD_MS, REEL_MAX_DAYS_AHEAD } from "@/lib/meta/reels-time";

const PAGE = "/admin/reels";

function back(status: string): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?status=${status}`);
}

/** A signed upload URL for a new Reel's video. */
export async function reelUploadAction(): Promise<{ path: string; token: string } | null> {
  await requireAdmin();
  return signedReelUpload();
}

const reelSchema = z.object({
  videoPath: z.string().regex(/^reels\/[0-9a-f-]{36}\.mp4$/),
  caption: z.string().trim().min(1).max(2100),
  when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  facebook: z.boolean(),
  instagram: z.boolean(),
  disclosure: z.boolean(),
});

export async function scheduleReelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = reelSchema.safeParse({
    videoPath: formData.get("videoPath"),
    caption: formData.get("caption"),
    when: formData.get("when"),
    facebook: formData.get("facebook") === "on",
    instagram: formData.get("instagram") === "on",
    disclosure: formData.get("disclosure") === "on",
  });
  if (!parsed.success) back("invalid");
  const r = parsed.data;
  if (!r.facebook && !r.instagram) back("no-network");
  const at = fromIsraelLocal(r.when);
  const now = Date.now();
  if (!at || at.getTime() < now + REEL_MIN_LEAD_MS) back("too-soon");
  if (at.getTime() > now + REEL_MAX_DAYS_AHEAD * 24 * 60 * 60_000) back("too-far");
  if (isQuietTime(at)) back("quiet");
  const caption = r.disclosure ? `${r.caption}\n\n${META_DISCLOSURE}` : r.caption;
  try {
    await insertReel({
      videoPath: r.videoPath,
      caption,
      scheduledAt: at,
      facebook: r.facebook,
      instagram: r.instagram,
    });
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-reels] schedule: ${String(err).slice(0, 200)}`);
    back("failed");
  }
  back("scheduled");
}

export async function cancelReelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  try {
    await cancelReel(id.data);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-reels] cancel: ${String(err).slice(0, 200)}`);
    back("failed");
  }
  back("cancelled");
}
