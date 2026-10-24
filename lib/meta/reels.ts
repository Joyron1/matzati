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
  video_id?: string;
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
  reel: { videoUrl: string; caption: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  if (!config.igUserId) return { ok: false, error: "META_IG_USER_ID is not set" };
  const answer = await call(
    config,
    graph(config, `${encodeURIComponent(config.igUserId)}/media`),
    {
      method: "POST",
      params: { media_type: "REELS", video_url: reel.videoUrl, caption: reel.caption },
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
