// The Meta schedule (owner requests 2026-10-24: Reels, then feed posts and stories), run by the
// agents' cron every 15 minutes. Within PREPARE_AHEAD_MS of its time an item is prepared where Meta
// needs time: every Instagram container (a Reel's or a story video's processing; an image's is
// quick), and on Facebook the uploads of a Reel or a video story (Meta fetches the file from a
// signed URL). Once its time has come it is published on each network still waiting; Facebook
// photo posts and photo stories are made in one go then. Each network's answer is stored on its
// own; one failing never stops the other. Pure: the store, the signer and Meta's calls are passed
// in (tests use fakes).
import type { MetaResult } from "./publish";
import type { ContainerStatus } from "./reels";

/** How long before its time an item is prepared (Meta processes videos meanwhile). */
export const PREPARE_AHEAD_MS = 60 * 60_000;
/** An item whose Instagram container is still processing this long after its time gives up. */
export const PROCESSING_GIVE_UP_MS = 6 * 60 * 60_000;
/** Items handled per run (the cron function has 60 s). */
export const REELS_PER_RUN = 4;

export type MetaKind = "reel" | "post" | "story";

export interface MetaMedia {
  path: string;
  type: "image" | "video";
}

export interface Reel {
  id: string;
  /** "reel" when unset (rows from before posts and stories). */
  kind?: MetaKind;
  video_path: string | null;
  /** A post's images (1-10) or a story's one image or video. */
  media?: MetaMedia[];
  caption: string;
  scheduled_at: string;
  facebook: boolean;
  instagram: boolean;
  status: "scheduled" | "cancelled" | "done" | "partial" | "failed";
  prepared_at: string | null;
  /** A Reel's or video story's Facebook upload; a posted photo or story's post id. */
  fb_video_id: string | null;
  fb_posted_at: string | null;
  fb_error: string | null;
  ig_container_id: string | null;
  ig_media_id: string | null;
  ig_posted_at: string | null;
  ig_error: string | null;
  /**
   * A story the owner posts from the app (for a link sticker, which the API cannot add): never
   * published here; at its time it is handed to the owner (notifyManual) and marked done.
   */
  manual?: boolean;
  link_url?: string | null;
  link_title?: string | null;
  notified_at?: string | null;
  notify_error?: string | null;
  manual_done_at?: string | null;
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
    | "notified_at"
    | "notify_error"
  >
>;

export interface ReelsDeps {
  /** Scheduled items whose time is before `until`, soonest first. */
  scheduledBefore(until: Date, limit: number): Promise<Reel[]>;
  update(id: string, patch: ReelPatch): Promise<void>;
  /** A URL Meta can fetch the file from (a signed URL, valid a few hours). */
  videoUrl(path: string): Promise<string | null>;
  /** Hands a manual story to the owner (their Telegram chat with the bot). */
  notifyManual(
    item: Reel,
    fileUrl: string | null,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  meta: {
    createInstagramReel(reel: { videoUrl: string; caption: string }): Promise<MetaResult>;
    createInstagramPost(post: { imageUrls: string[]; caption: string }): Promise<MetaResult>;
    createInstagramStory(story: { url: string; video: boolean }): Promise<MetaResult>;
    instagramContainerStatus(
      id: string,
    ): Promise<{ ok: true; status: ContainerStatus } | { ok: false; error: string }>;
    publishInstagramContainer(id: string): Promise<MetaResult>;
    uploadFacebookReel(videoUrl: string): Promise<MetaResult>;
    publishFacebookReel(reel: { videoId: string; description: string }): Promise<MetaResult>;
    publishFacebookPhotos(post: { imageUrls: string[]; caption: string }): Promise<MetaResult>;
    publishFacebookPhotoStory(imageUrl: string): Promise<MetaResult>;
    uploadFacebookVideoStory(videoUrl: string): Promise<MetaResult>;
    publishFacebookVideoStory(videoId: string): Promise<MetaResult>;
  };
}

export interface ReelsSummary {
  prepared: number;
  published: number;
  failed: number;
}

const kindOf = (r: Reel): MetaKind => r.kind ?? "reel";
/** The item's files in order: a Reel's video, else its media. */
const filesOf = (r: Reel): MetaMedia[] =>
  kindOf(r) === "reel"
    ? r.video_path
      ? [{ path: r.video_path, type: "video" }]
      : []
    : (r.media ?? []);
/** Facebook needs an upload ahead for a Reel and a video story only. */
const fbUploadsAhead = (r: Reel) =>
  kindOf(r) === "reel" || (kindOf(r) === "story" && filesOf(r)[0]?.type === "video");

const igWaiting = (r: Reel) => r.instagram && !r.ig_posted_at && !r.ig_error;
const fbWaiting = (r: Reel) => r.facebook && !r.fb_posted_at && !r.fb_error;

/** The item's status once no network is waiting: done, partial or failed. */
export function finalStatus(r: Reel): Reel["status"] {
  if (igWaiting(r) || fbWaiting(r)) return "scheduled";
  const asked = [
    r.facebook ? !!r.fb_posted_at : null,
    r.instagram ? !!r.ig_posted_at : null,
  ].filter((v): v is boolean => v !== null);
  if (asked.every(Boolean)) return "done";
  return asked.some(Boolean) ? "partial" : "failed";
}

/** Signed URLs for every file, or null when one is missing from storage. */
async function signAll(deps: ReelsDeps, files: MetaMedia[]): Promise<string[] | null> {
  if (!files.length) return null;
  const urls: string[] = [];
  for (const f of files) {
    const url = await deps.videoUrl(f.path);
    if (!url) return null;
    urls.push(url);
  }
  return urls;
}

const MISSING = "the file is not in storage";

export async function runReels(deps: ReelsDeps, now: Date = new Date()): Promise<ReelsSummary> {
  const summary: ReelsSummary = { prepared: 0, published: 0, failed: 0 };
  const items = await deps.scheduledBefore(
    new Date(now.getTime() + PREPARE_AHEAD_MS),
    REELS_PER_RUN,
  );
  for (const original of items) {
    let r = { ...original };
    const patch: ReelPatch = {};
    const set = (p: ReelPatch) => {
      Object.assign(patch, p);
      r = { ...r, ...p };
    };
    const kind = kindOf(r);
    const files = filesOf(r);
    const due = new Date(r.scheduled_at).getTime() <= now.getTime();

    // A manual story: nothing to prepare or publish; at its time it goes to the owner. It is done
    // either way (the panel lists it with the file and the link), with the hand-off's error kept.
    if (r.manual) {
      if (due && !r.notified_at) {
        const url = files[0] ? await deps.videoUrl(files[0].path) : null;
        const n = await deps.notifyManual(r, url);
        set({
          notified_at: now.toISOString(),
          notify_error: n.ok ? null : n.error,
          status: "done",
        });
        summary.published++;
        await deps.update(r.id, patch);
      }
      continue;
    }

    // 1. Prepare what is not prepared yet (the first run within the hour, or a late one).
    const needsIg = igWaiting(r) && !r.ig_container_id;
    const needsFb = fbWaiting(r) && fbUploadsAhead(r) && !r.fb_video_id;
    if (needsIg || needsFb) {
      const urls = await signAll(deps, files);
      if (!urls) {
        set({
          ...(needsIg ? { ig_error: MISSING } : {}),
          ...(needsFb ? { fb_error: MISSING } : {}),
        });
      } else {
        if (needsIg) {
          const c =
            kind === "reel"
              ? await deps.meta.createInstagramReel({ videoUrl: urls[0], caption: r.caption })
              : kind === "post"
                ? await deps.meta.createInstagramPost({ imageUrls: urls, caption: r.caption })
                : await deps.meta.createInstagramStory({
                    url: urls[0],
                    video: files[0].type === "video",
                  });
          set(c.ok ? { ig_container_id: c.id } : { ig_error: c.error });
        }
        if (needsFb) {
          const u =
            kind === "reel"
              ? await deps.meta.uploadFacebookReel(urls[0])
              : await deps.meta.uploadFacebookVideoStory(urls[0]);
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
          set({ ig_error: `Instagram could not process the media (${s.status})` });
        } else if (
          s.status === "IN_PROGRESS" &&
          now.getTime() - new Date(r.scheduled_at).getTime() > PROCESSING_GIVE_UP_MS
        ) {
          set({ ig_error: "Instagram was still processing the media 6 hours after its time" });
        }
        // IN_PROGRESS: the next run (15 minutes) tries again.
      }
      if (fbWaiting(r)) {
        if (fbUploadsAhead(r)) {
          if (r.fb_video_id) {
            const p =
              kind === "reel"
                ? await deps.meta.publishFacebookReel({
                    videoId: r.fb_video_id,
                    description: r.caption,
                  })
                : await deps.meta.publishFacebookVideoStory(r.fb_video_id);
            set(p.ok ? { fb_posted_at: now.toISOString() } : { fb_error: p.error });
          }
        } else {
          const urls = await signAll(deps, files);
          if (!urls) {
            set({ fb_error: MISSING });
          } else {
            const p =
              kind === "post"
                ? await deps.meta.publishFacebookPhotos({ imageUrls: urls, caption: r.caption })
                : await deps.meta.publishFacebookPhotoStory(urls[0]);
            set(
              p.ok ? { fb_video_id: p.id, fb_posted_at: now.toISOString() } : { fb_error: p.error },
            );
          }
        }
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
