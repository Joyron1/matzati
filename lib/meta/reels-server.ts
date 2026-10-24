// The Reels' storage and wiring (owner request 2026-10-24): the meta_reels table (service role
// only), the private bucket agent-media (reels/<uuid>.mp4, signed URLs), and runReels with Meta's
// real calls. Server-only; the admin page's actions call requireAdmin() first.
import "server-only";
import { deployEnv } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";
import { metaConfig } from "./publish";
import {
  createInstagramReel,
  instagramContainerStatus,
  publishFacebookReel,
  publishInstagramContainer,
  uploadFacebookReel,
} from "./reels";
import { runReels, type Reel, type ReelPatch, type ReelsSummary } from "./reels-run";

const TABLE = "meta_reels";
const BUCKET = "agent-media";
/** How long Meta may fetch the video from its signed URL. */
const VIDEO_URL_SECONDS = 3 * 60 * 60;

const COLUMNS =
  "id, video_path, caption, scheduled_at, facebook, instagram, status, prepared_at, fb_video_id, fb_posted_at, fb_error, ig_container_id, ig_media_id, ig_posted_at, ig_error, created_at";

/** Every Reel, the next first, then the posted ones newest first (the admin page). */
export async function listReels(): Promise<Reel[]> {
  const { data, error } = await serviceClient()
    .from(TABLE)
    .select(COLUMNS)
    .order("scheduled_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`reels: ${error.message}`);
  return (data ?? []) as Reel[];
}

export async function insertReel(reel: {
  videoPath: string;
  caption: string;
  scheduledAt: Date;
  facebook: boolean;
  instagram: boolean;
}): Promise<void> {
  const { error } = await serviceClient().from(TABLE).insert({
    video_path: reel.videoPath,
    caption: reel.caption,
    scheduled_at: reel.scheduledAt.toISOString(),
    facebook: reel.facebook,
    instagram: reel.instagram,
  });
  if (error) throw new Error(`reels insert: ${error.message}`);
}

/** Cancels a Reel that has not gone out (a prepared container or upload is simply left). */
export async function cancelReel(id: string): Promise<void> {
  const { error } = await serviceClient()
    .from(TABLE)
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) throw new Error(`reels cancel: ${error.message}`);
}

/** A signed upload URL for a new Reel's video (the browser uploads straight to storage). */
export async function signedReelUpload(): Promise<{ path: string; token: string } | null> {
  const path = `reels/${crypto.randomUUID()}.mp4`;
  const { data, error } = await serviceClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return null;
  return { path: data.path, token: data.token };
}

export async function signedReelUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data } = await serviceClient().storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

/** The cron's run: production only (dev and preview share the database), Meta configured. */
export async function publishDueReels(now = new Date()): Promise<ReelsSummary | null> {
  if (deployEnv() !== "production") return null;
  const config = metaConfig();
  if (!config) return null;
  const db = serviceClient();
  return runReels(
    {
      async scheduledBefore(until, limit) {
        const { data, error } = await db
          .from(TABLE)
          .select(COLUMNS)
          .eq("status", "scheduled")
          .lte("scheduled_at", until.toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(limit);
        if (error) throw new Error(`reels due: ${error.message}`);
        return (data ?? []) as Reel[];
      },
      async update(id, patch: ReelPatch) {
        const { error } = await db.from(TABLE).update(patch).eq("id", id);
        if (error) throw new Error(`reels update: ${error.message}`);
      },
      videoUrl: (path) => signedReelUrl(path, VIDEO_URL_SECONDS),
      meta: {
        createInstagramReel: (reel) => createInstagramReel(config, reel),
        instagramContainerStatus: (id) => instagramContainerStatus(config, id),
        publishInstagramContainer: (id) => publishInstagramContainer(config, id),
        uploadFacebookReel: (url) => uploadFacebookReel(config, url),
        publishFacebookReel: (reel) => publishFacebookReel(config, reel),
      },
    },
    now,
  );
}
