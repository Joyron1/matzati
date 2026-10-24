"use server";

// The Meta panel's actions (owner requests 2026-10-24: Reels, then feed posts and stories). Every
// action checks requireAdmin() first.
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { isQuietTime } from "@/lib/agents/schedule";
import { META_DISCLOSURE } from "@/lib/meta/publish";
import { cancelReel, insertReel, signedReelUpload } from "@/lib/meta/reels-server";
import { fromIsraelLocal, REEL_MIN_LEAD_MS, REEL_MAX_DAYS_AHEAD } from "@/lib/meta/reels-time";

const PAGE = "/admin/meta";

function back(status: string): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?status=${status}`);
}

/** A signed upload URL for a new file: a Reel's video, or a post's or story's image or video. */
export async function metaUploadAction(
  kind: "reel" | "image" | "video",
): Promise<{ path: string; token: string } | null> {
  await requireAdmin();
  if (kind !== "reel" && kind !== "image" && kind !== "video") return null;
  return signedReelUpload(kind);
}

const mediaSchema = z
  .array(
    z
      .object({
        path: z.string().regex(/^meta\/[0-9a-f-]{36}\.(jpg|mp4)$/),
        type: z.enum(["image", "video"]),
      })
      .refine((m) => m.path.endsWith(m.type === "image" ? ".jpg" : ".mp4")),
  )
  .max(10);

const schema = z.object({
  kind: z.enum(["reel", "post", "story"]),
  videoPath: z.string(),
  media: z.string().max(4000),
  caption: z.string().trim().max(2100),
  when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  facebook: z.boolean(),
  instagram: z.boolean(),
  disclosure: z.boolean(),
});

export async function scheduleMetaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    videoPath: formData.get("videoPath") ?? "",
    media: formData.get("media") ?? "[]",
    caption: formData.get("caption") ?? "",
    when: formData.get("when"),
    facebook: formData.get("facebook") === "on",
    instagram: formData.get("instagram") === "on",
    disclosure: formData.get("disclosure") === "on",
  });
  if (!parsed.success) back("invalid");
  const r = parsed.data;
  if (!r.facebook && !r.instagram) back("no-network");

  let media: z.infer<typeof mediaSchema> = [];
  let videoPath: string | null = null;
  if (r.kind === "reel") {
    if (!/^reels\/[0-9a-f-]{36}\.mp4$/.test(r.videoPath)) back("no-media");
    videoPath = r.videoPath;
  } else {
    const m = mediaSchema.safeParse(
      (() => {
        try {
          return JSON.parse(r.media);
        } catch {
          return null;
        }
      })(),
    );
    if (!m.success) back("invalid");
    media = m.data;
    if (!media.length) back("no-media");
    // A post is images only (a video post is a Reel); a story is one image or one video.
    if (r.kind === "post" && media.some((x) => x.type !== "image")) back("invalid");
    if (r.kind === "story" && media.length !== 1) back("invalid");
  }
  // Stories have no caption on either network.
  if (r.kind !== "story" && !r.caption) back("no-caption");

  const at = fromIsraelLocal(r.when);
  const now = Date.now();
  if (!at || at.getTime() < now + REEL_MIN_LEAD_MS) back("too-soon");
  if (at.getTime() > now + REEL_MAX_DAYS_AHEAD * 24 * 60 * 60_000) back("too-far");
  if (isQuietTime(at)) back("quiet");
  const caption =
    r.kind === "story" ? "" : r.disclosure ? `${r.caption}\n\n${META_DISCLOSURE}` : r.caption;
  try {
    await insertReel({
      kind: r.kind,
      videoPath,
      media,
      caption,
      scheduledAt: at,
      facebook: r.facebook,
      instagram: r.instagram,
    });
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-meta] schedule: ${String(err).slice(0, 200)}`);
    back("failed");
  }
  back(`scheduled-${r.kind}`);
}

export async function cancelMetaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  try {
    await cancelReel(id.data);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-meta] cancel: ${String(err).slice(0, 200)}`);
    back("failed");
  }
  back("cancelled");
}
