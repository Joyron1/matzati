// The Reels' schedule (owner request 2026-10-24), run by the agents' cron every 15 minutes: a Reel
// whose time is within PREPARE_AHEAD_MS is prepared (Instagram container, Facebook upload, both
// fetching the video from a signed URL), and one whose time has come is published on each network
// still waiting. Each network's answer is stored on its own; one failing never stops the other.
// Pure: the store, the signer and Meta's calls are passed in (tests use fakes).
import type { MetaResult } from "./publish";
import type { ContainerStatus } from "./reels";

/** How long before its time a Reel is prepared (Meta processes the video meanwhile). */
export const PREPARE_AHEAD_MS = 60 * 60_000;
/** A Reel whose Instagram container is still processing this long after its time gives up. */
export const PROCESSING_GIVE_UP_MS = 6 * 60 * 60_000;
/** Reels handled per run (the cron function has 60 s). */
export const REELS_PER_RUN = 4;

export interface Reel {
  id: string;
  video_path: string;
  caption: string;
  scheduled_at: string;
  facebook: boolean;
  instagram: boolean;
  status: "scheduled" | "cancelled" | "done" | "partial" | "failed";
  prepared_at: string | null;
  fb_video_id: string | null;
  fb_posted_at: string | null;
  fb_error: string | null;
  ig_container_id: string | null;
  ig_media_id: string | null;
  ig_posted_at: string | null;
  ig_error: string | null;
  created_at: string;
}

export type ReelPatch = Partial<
  Pick<
    Reel,
    | "status"
    | "prepared_at"
    | "fb_video_id"
    | "fb_posted_at"
    | "fb_error"
    | "ig_container_id"
    | "ig_media_id"
    | "ig_posted_at"
    | "ig_error"
  >
>;

export interface ReelsDeps {
  /** Scheduled Reels whose time is before `until`, soonest first. */
  scheduledBefore(until: Date, limit: number): Promise<Reel[]>;
  update(id: string, patch: ReelPatch): Promise<void>;
  /** A URL Meta can fetch the video from (a signed URL, valid a few hours). */
  videoUrl(path: string): Promise<string | null>;
  meta: {
    createInstagramReel(reel: { videoUrl: string; caption: string }): Promise<MetaResult>;
    instagramContainerStatus(
      id: string,
    ): Promise<{ ok: true; status: ContainerStatus } | { ok: false; error: string }>;
    publishInstagramContainer(id: string): Promise<MetaResult>;
    uploadFacebookReel(videoUrl: string): Promise<MetaResult>;
    publishFacebookReel(reel: { videoId: string; description: string }): Promise<MetaResult>;
  };
}

export interface ReelsSummary {
  prepared: number;
  published: number;
  failed: number;
}

const igWaiting = (r: Reel) => r.instagram && !r.ig_posted_at && !r.ig_error;
const fbWaiting = (r: Reel) => r.facebook && !r.fb_posted_at && !r.fb_error;

/** The Reel's status once no network is waiting: done, partial or failed. */
export function finalStatus(r: Reel): Reel["status"] {
  if (igWaiting(r) || fbWaiting(r)) return "scheduled";
  const asked = [
    r.facebook ? !!r.fb_posted_at : null,
    r.instagram ? !!r.ig_posted_at : null,
  ].filter((v): v is boolean => v !== null);
  if (asked.every(Boolean)) return "done";
  return asked.some(Boolean) ? "partial" : "failed";
}

export async function runReels(deps: ReelsDeps, now: Date = new Date()): Promise<ReelsSummary> {
  const summary: ReelsSummary = { prepared: 0, published: 0, failed: 0 };
  const reels = await deps.scheduledBefore(
    new Date(now.getTime() + PREPARE_AHEAD_MS),
    REELS_PER_RUN,
  );
  for (const original of reels) {
    let r = { ...original };
    const patch: ReelPatch = {};
    const set = (p: ReelPatch) => {
      Object.assign(patch, p);
      r = { ...r, ...p };
    };
    const due = new Date(r.scheduled_at).getTime() <= now.getTime();

    // 1. Prepare what is not prepared yet (the first run within the hour, or a late one).
    const needsIg = igWaiting(r) && !r.ig_container_id;
    const needsFb = fbWaiting(r) && !r.fb_video_id;
    if (needsIg || needsFb) {
      const url = await deps.videoUrl(r.video_path);
      if (!url) {
        set({
          ...(needsIg ? { ig_error: "the video is not in storage" } : {}),
          ...(needsFb ? { fb_error: "the video is not in storage" } : {}),
        });
      } else {
        if (needsIg) {
          const c = await deps.meta.createInstagramReel({ videoUrl: url, caption: r.caption });
          set(c.ok ? { ig_container_id: c.id } : { ig_error: c.error });
        }
        if (needsFb) {
          const u = await deps.meta.uploadFacebookReel(url);
          set(u.ok ? { fb_video_id: u.id } : { fb_error: u.error });
        }
      }
      set({ prepared_at: now.toISOString() });
      summary.prepared++;
    }

    // 2. Publish once its time has come.
    if (due) {
      if (igWaiting(r) && r.ig_container_id) {
        const s = await deps.meta.instagramContainerStatus(r.ig_container_id);
        if (!s.ok) {
          set({ ig_error: s.error });
        } else if (s.status === "FINISHED") {
          const p = await deps.meta.publishInstagramContainer(r.ig_container_id);
          set(
            p.ok ? { ig_media_id: p.id, ig_posted_at: now.toISOString() } : { ig_error: p.error },
          );
        } else if (s.status === "ERROR" || s.status === "EXPIRED") {
          set({ ig_error: `Instagram could not process the video (${s.status})` });
        } else if (
          s.status === "IN_PROGRESS" &&
          now.getTime() - new Date(r.scheduled_at).getTime() > PROCESSING_GIVE_UP_MS
        ) {
          set({ ig_error: "Instagram was still processing the video 6 hours after its time" });
        }
        // IN_PROGRESS: the next run (15 minutes) tries again.
      }
      if (fbWaiting(r) && r.fb_video_id) {
        const p = await deps.meta.publishFacebookReel({
          videoId: r.fb_video_id,
          description: r.caption,
        });
        set(p.ok ? { fb_posted_at: now.toISOString() } : { fb_error: p.error });
      }
      const status = finalStatus(r);
      if (status !== "scheduled") {
        set({ status });
        if (status === "failed") summary.failed++;
        else summary.published++;
      }
    }

    if (Object.keys(patch).length) await deps.update(r.id, patch);
  }
  return summary;
}
