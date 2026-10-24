// Reels on the Facebook Page and its Instagram account (owner request 2026-10-24), through Meta's
// Graph API with the same Page token as lib/meta/publish.ts. Docs checked 2026-10-24:
// - Instagram (developers.facebook.com/docs/instagram-platform/content-publishing): POST
//   /{ig-id}/media with media_type=REELS, video_url (public) and caption makes a container; GET
//   /{container}?fields=status_code until FINISHED (also IN_PROGRESS, ERROR, EXPIRED after 24 h,
//   PUBLISHED); POST /{ig-id}/media_publish with creation_id. No scheduling in the API: our cron
//   publishes at the time. 100 API posts a 24 h.
// - Facebook (developers.facebook.com/docs/video-api/guides/reels-publishing): POST
//   /{page-id}/video_reels upload_phase=start gives video_id; POST
//   rupload.facebook.com/video-upload/{version}/{video-id} with `Authorization: OAuth <token>` and a
//   `file_url` header has Meta fetch the file; POST /{page-id}/video_reels upload_phase=finish,
//   video_state=PUBLISHED, description publishes it. 30 API Reels a 24 h. Video: MP4, 9:16, 3-90 s,
//   24-60 fps, H.264/H.265, AAC.
// The token is only ever in an Authorization header, never in a URL, a log or a stored error.
import type { MetaConfig, MetaResult } from "./publish";

interface GraphAnswer {
  id?: string;
  post_id?: string;
  video_id?: string;
  upload_url?: string;
  success?: boolean;
  status_code?: string;
  error?: { message?: string; code?: number; error_subcode?: number };
}

type Answer =
  { status: number; body: GraphAnswer | null } | { status: 0; body: null; name: string };

async function call(
  config: MetaConfig,
  url: string,
  init: {
    method: "GET" | "POST";
    params?: Record<string, string>;
    headers?: Record<string, string>;
  },
  fetchImpl: typeof fetch,
): Promise<Answer> {
  try {
    const res = await fetchImpl(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(init.params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...init.headers,
      },
      ...(init.params ? { body: new URLSearchParams(init.params).toString() } : {}),
      signal: AbortSignal.timeout(25_000),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as GraphAnswer | null };
  } catch (err) {
    return { status: 0, body: null, name: err instanceof Error ? err.name : "network error" };
  }
}

function failed(answer: Answer, token: string, step: string): { ok: false; error: string } {
  if (answer.status === 0)
    return { ok: false, error: `${step}: ${"name" in answer ? answer.name : "network error"}` };
  const message = (answer.body?.error?.message ?? "no answer").split(token).join("[token]");
  return { ok: false, error: `${step}: Meta ${answer.status}: ${message}`.slice(0, 300) };
}

const graph = (config: MetaConfig, path: string) =>
  `https://graph.facebook.com/${config.version}/${path}`;

// --- Instagram -----------------------------------------------------------------------------------

/** Creates the Reel's container (Meta then fetches and processes the video). */
export async function createInstagramReel(
  config: MetaConfig,
  reel: { videoUrl: string; caption: string; coverUrl?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  if (!config.igUserId) return { ok: false, error: "META_IG_USER_ID is not set" };
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.igUserId)}/media`),
    {
      method: "POST",
      params: {
        media_type: "REELS",
        video_url: reel.videoUrl,
        caption: reel.caption,
        // The Reel's cover (JPEG; Meta crops it to the middle 9:16). Without it, the first frame.
        ...(reel.coverUrl ? { cover_url: reel.coverUrl } : {}),
      },
    },
    fetchImpl,
  );
  const id = answer.body?.id;
  return answer.status === 200 && id ? { ok: true, id } : failed(answer, config.token, "container");
}

export type ContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** A container's processing status, or an error. */
export async function instagramContainerStatus(
  config: MetaConfig,
  containerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; status: ContainerStatus } | { ok: false; error: string }> {
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(containerId)}?fields=status_code`),
    { method: "GET" },
    fetchImpl,
  );
  const status = answer.body?.status_code;
  if (answer.status === 200 && status) return { ok: true, status: status as ContainerStatus };
  return failed(answer, config.token, "status");
}

/** Publishes a FINISHED container. */
export async function publishInstagramContainer(
  config: MetaConfig,
  containerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  if (!config.igUserId) return { ok: false, error: "META_IG_USER_ID is not set" };
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.igUserId)}/media_publish`),
    { method: "POST", params: { creation_id: containerId } },
    fetchImpl,
  );
  const id = answer.body?.id;
  return answer.status === 200 && id ? { ok: true, id } : failed(answer, config.token, "publish");
}

// --- Facebook ------------------------------------------------------------------------------------

/** Starts the Reel's upload and has Meta fetch the file from `videoUrl`: the video id. */
export async function uploadFacebookReel(
  config: MetaConfig,
  videoUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const start = await call(
    config,
    graph(config, `${encodeURIComponent(config.pageId)}/video_reels`),
    { method: "POST", params: { upload_phase: "start" } },
    fetchImpl,
  );
  const videoId = start.body?.video_id;
  if (start.status !== 200 || !videoId) return failed(start, config.token, "start");
  const upload = await call(
    config,
    `https://rupload.facebook.com/video-upload/${config.version}/${encodeURIComponent(videoId)}`,
    { method: "POST", headers: { Authorization: `OAuth ${config.token}`, file_url: videoUrl } },
    fetchImpl,
  );
  if (upload.status !== 200 || upload.body?.success !== true) {
    return failed(upload, config.token, "upload");
  }
  return { ok: true, id: videoId };
}

/** Publishes an uploaded Reel now, with its description. */
export async function publishFacebookReel(
  config: MetaConfig,
  reel: { videoId: string; description: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.pageId)}/video_reels`),
    {
      method: "POST",
      params: {
        upload_phase: "finish",
        video_id: reel.videoId,
        video_state: "PUBLISHED",
        description: reel.description,
      },
    },
    fetchImpl,
  );
  return answer.status === 200 && answer.body?.success === true
    ? { ok: true, id: reel.videoId }
    : failed(answer, config.token, "finish");
}

// --- Posts and stories (owner request 2026-10-24, docs checked the same day) ---------------------
// Instagram (developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/
// media): an image container takes image_url (JPEG, 8 MB, ratio 4:5 to 1.91:1); a carousel is up to
// 20 children made with is_carousel_item=true (no caption on a child), then media_type=CAROUSEL with
// children (ids, comma-separated) and the caption; a story is media_type=STORIES with image_url or
// video_url (no caption; video 3-60 s). Each is published with media_publish once FINISHED.
// Facebook: POST /{page-id}/photos with url and caption posts one photo; for several, each is
// uploaded with published=false and POST /{page-id}/feed takes message and attached_media[i] =
// {"media_fbid": id} (docs/graph-api/reference/page/photos). Stories (docs/page-stories-api): a
// photo story is an unpublished /photos upload, then POST /{page-id}/photo_stories with photo_id;
// a video story is POST /{page-id}/video_stories upload_phase=start (video_id, upload_url), the
// upload_url with a file_url header, then upload_phase=finish with video_id.

/** One Instagram container: an image, a carousel child, a carousel or a story. */
export async function createInstagramContainer(
  config: MetaConfig,
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  if (!config.igUserId) return { ok: false, error: "META_IG_USER_ID is not set" };
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.igUserId)}/media`),
    { method: "POST", params },
    fetchImpl,
  );
  const id = answer.body?.id;
  return answer.status === 200 && id ? { ok: true, id } : failed(answer, config.token, "container");
}

/** A feed post's container: one image, or a carousel of its images (children made first). */
export async function createInstagramPost(
  config: MetaConfig,
  post: { imageUrls: string[]; caption: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  if (post.imageUrls.length === 1) {
    return createInstagramContainer(
      config,
      { image_url: post.imageUrls[0], caption: post.caption },
      fetchImpl,
    );
  }
  const children: string[] = [];
  for (const url of post.imageUrls) {
    const child = await createInstagramContainer(
      config,
      { image_url: url, is_carousel_item: "true" },
      fetchImpl,
    );
    if (!child.ok) return child;
    children.push(child.id);
  }
  return createInstagramContainer(
    config,
    { media_type: "CAROUSEL", children: children.join(","), caption: post.caption },
    fetchImpl,
  );
}

/** A story's container: one image or one video. */
export function createInstagramStory(
  config: MetaConfig,
  story: { url: string; video: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  return createInstagramContainer(
    config,
    { media_type: "STORIES", [story.video ? "video_url" : "image_url"]: story.url },
    fetchImpl,
  );
}

async function unpublishedPhoto(
  config: MetaConfig,
  url: string,
  fetchImpl: typeof fetch,
): Promise<MetaResult> {
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.pageId)}/photos`),
    { method: "POST", params: { url, published: "false" } },
    fetchImpl,
  );
  const id = answer.body?.id;
  return answer.status === 200 && id ? { ok: true, id } : failed(answer, config.token, "photo");
}

/** Posts the images on the Page now: one photo post, or a multi-photo post. */
export async function publishFacebookPhotos(
  config: MetaConfig,
  post: { imageUrls: string[]; caption: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const page = encodeURIComponent(config.pageId);
  if (post.imageUrls.length === 1) {
    const answer = await call(
      config,
      graph(config, `${page}/photos`),
      { method: "POST", params: { url: post.imageUrls[0], caption: post.caption } },
      fetchImpl,
    );
    const id = answer.body?.post_id ?? answer.body?.id;
    return answer.status === 200 && id ? { ok: true, id } : failed(answer, config.token, "photo");
  }
  const params: Record<string, string> = { message: post.caption };
  for (const [i, url] of post.imageUrls.entries()) {
    const photo = await unpublishedPhoto(config, url, fetchImpl);
    if (!photo.ok) return photo;
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: photo.id });
  }
  const answer = await call(
    config,
    graph(config, `${page}/feed`),
    { method: "POST", params },
    fetchImpl,
  );
  const id = answer.body?.id;
  return answer.status === 200 && id ? { ok: true, id } : failed(answer, config.token, "feed");
}

/** Posts a photo story on the Page now. */
export async function publishFacebookPhotoStory(
  config: MetaConfig,
  imageUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const photo = await unpublishedPhoto(config, imageUrl, fetchImpl);
  if (!photo.ok) return photo;
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.pageId)}/photo_stories`),
    { method: "POST", params: { photo_id: photo.id } },
    fetchImpl,
  );
  const id = answer.body?.post_id;
  return answer.status === 200 && answer.body?.success === true && id
    ? { ok: true, id }
    : failed(answer, config.token, "story");
}

/** Starts a video story's upload and has Meta fetch the file: the video id. */
export async function uploadFacebookVideoStory(
  config: MetaConfig,
  videoUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const start = await call(
    config,
    graph(config, `${encodeURIComponent(config.pageId)}/video_stories`),
    { method: "POST", params: { upload_phase: "start" } },
    fetchImpl,
  );
  const videoId = start.body?.video_id;
  const uploadUrl = start.body?.upload_url;
  // The token goes only to Meta's upload host.
  if (start.status !== 200 || !videoId || !uploadUrl?.startsWith("https://rupload.facebook.com/")) {
    return failed(start, config.token, "start");
  }
  const upload = await call(
    config,
    uploadUrl,
    { method: "POST", headers: { Authorization: `OAuth ${config.token}`, file_url: videoUrl } },
    fetchImpl,
  );
  if (upload.status !== 200 || upload.body?.success !== true) {
    return failed(upload, config.token, "upload");
  }
  return { ok: true, id: videoId };
}

/** Publishes an uploaded video story now. */
export async function publishFacebookVideoStory(
  config: MetaConfig,
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.pageId)}/video_stories`),
    { method: "POST", params: { upload_phase: "finish", video_id: videoId } },
    fetchImpl,
  );
  const id = answer.body?.post_id ?? videoId;
  return answer.status === 200 && answer.body?.success === true
    ? { ok: true, id }
    : failed(answer, config.token, "finish");
}

/**
 * Sets an uploaded Facebook Reel's cover (owner request 2026-10-24): POST /{video-id}/thumbnails
 * with the image as a multipart file (`source`, up to 10 MB; the docs take no URL) and
 * is_preferred=true (docs/graph-api/reference/video/thumbnails, checked 2026-10-24).
 */
export async function setFacebookReelCover(
  config: MetaConfig,
  videoId: string,
  image: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const form = new FormData();
  form.append("source", image, "cover.jpg");
  form.append("is_preferred", "true");
  try {
    const res = await fetchImpl(graph(config, `${encodeURIComponent(videoId)}/thumbnails`), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    const body = (await res.json().catch(() => null)) as GraphAnswer | null;
    return res.status === 200 && (body?.success === true || body?.id)
      ? { ok: true, id: videoId }
      : failed({ status: res.status, body }, config.token, "cover");
  } catch (err) {
    return failed(
      { status: 0, body: null, name: err instanceof Error ? err.name : "network error" },
      config.token,
      "cover",
    );
  }
}
