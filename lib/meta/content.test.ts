import { describe, expect, it, vi } from "vitest";
import type { MetaConfig, MetaResult } from "./publish";
import {
  createInstagramPost,
  createInstagramStory,
  publishFacebookPhotos,
  publishFacebookPhotoStory,
  uploadFacebookVideoStory,
} from "./reels";
import { runReels, type Reel, type ReelsDeps } from "./reels-run";

const CONFIG: MetaConfig = {
  pageId: "111",
  token: "SECRET-TOKEN",
  igUserId: "222",
  version: "v26.0",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const bodyOf = (call: Parameters<typeof fetch>) =>
  new URLSearchParams(String((call[1] as RequestInit).body ?? ""));

describe("Meta's post and story calls", () => {
  it("makes a carousel: a child per image, then the carousel with the caption", async () => {
    let n = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => json({ id: `C${++n}` }));
    const r = await createInstagramPost(
      CONFIG,
      { imageUrls: ["https://x/1.jpg", "https://x/2.jpg"], caption: "שלום" },
      fetchMock,
    );
    expect(r).toEqual({ ok: true, id: "C3" });
    const calls = fetchMock.mock.calls.map(bodyOf);
    expect(calls[0].get("is_carousel_item")).toBe("true");
    expect(calls[0].get("caption")).toBeNull();
    expect(calls[2].get("media_type")).toBe("CAROUSEL");
    expect(calls[2].get("children")).toBe("C1,C2");
    expect(calls[2].get("caption")).toBe("שלום");
    for (const c of fetchMock.mock.calls) expect(String(c[0])).not.toContain("SECRET");
  });

  it("makes a single image post without a carousel", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ id: "C1" }));
    await createInstagramPost(CONFIG, { imageUrls: ["https://x/1.jpg"], caption: "a" }, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]).get("image_url")).toBe("https://x/1.jpg");
  });

  it("makes a story container with image_url or video_url", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ id: "S1" }));
    await createInstagramStory(CONFIG, { url: "https://x/v.mp4", video: true }, fetchMock);
    const b = bodyOf(fetchMock.mock.calls[0]);
    expect(b.get("media_type")).toBe("STORIES");
    expect(b.get("video_url")).toBe("https://x/v.mp4");
    expect(b.get("image_url")).toBeNull();
  });

  it("posts several Facebook photos unpublished, then one feed post with attached_media", async () => {
    let n = 0;
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/feed") ? json({ id: "POST" }) : json({ id: `P${++n}` }),
    );
    const r = await publishFacebookPhotos(
      CONFIG,
      { imageUrls: ["https://x/1.jpg", "https://x/2.jpg"], caption: "טקסט" },
      fetchMock,
    );
    expect(r).toEqual({ ok: true, id: "POST" });
    expect(bodyOf(fetchMock.mock.calls[0]).get("published")).toBe("false");
    const feed = bodyOf(fetchMock.mock.calls[2]);
    expect(feed.get("message")).toBe("טקסט");
    expect(feed.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "P2" }));
  });

  it("posts a photo story: an unpublished photo, then photo_stories", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/photo_stories")
        ? json({ success: true, post_id: "ST1" })
        : json({ id: "P1" }),
    );
    const r = await publishFacebookPhotoStory(CONFIG, "https://x/1.jpg", fetchMock);
    expect(r).toEqual({ ok: true, id: "ST1" });
    expect(bodyOf(fetchMock.mock.calls[1]).get("photo_id")).toBe("P1");
  });

  it("never sends the token to an upload host that is not Meta's", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ video_id: "V1", upload_url: "https://evil.example/up" }),
    );
    const r = await uploadFacebookVideoStory(CONFIG, "https://x/v.mp4", fetchMock);
    expect(r.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

const NOW = new Date("2026-10-26T17:30:00Z");
const AT = new Date("2026-10-26T18:00:00Z");

function item(o: Partial<Reel>): Reel {
  return {
    id: "r1",
    kind: "post",
    video_path: null,
    media: [
      { path: "meta/a.jpg", type: "image" },
      { path: "meta/b.jpg", type: "image" },
    ],
    caption: "כיתוב",
    scheduled_at: AT.toISOString(),
    facebook: true,
    instagram: true,
    status: "scheduled",
    prepared_at: null,
    fb_video_id: null,
    fb_posted_at: null,
    fb_error: null,
    ig_container_id: null,
    ig_media_id: null,
    ig_posted_at: null,
    ig_error: null,
    created_at: "2026-10-24T10:00:00Z",
    ...o,
  };
}

function deps(items: Reel[]) {
  const updates: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const ok =
    (name: string, id: string) =>
    async (): Promise<MetaResult> => {
      calls.push(name);
      return { ok: true, id };
    };
  const d: ReelsDeps = {
    scheduledBefore: async () => items,
    update: async (_id, patch) => void updates.push(patch),
    videoUrl: async (p) => `https://signed/${p}`,
    meta: {
      createInstagramReel: ok("igReel", "CR"),
      createInstagramPost: ok("igPost", "CP"),
      createInstagramStory: ok("igStory", "CS"),
      instagramContainerStatus: async () => ({ ok: true, status: "FINISHED" }),
      publishInstagramContainer: ok("igPublish", "M1"),
      uploadFacebookReel: ok("fbReelUpload", "V1"),
      publishFacebookReel: ok("fbReel", "V1"),
      publishFacebookPhotos: ok("fbPhotos", "FP"),
      publishFacebookPhotoStory: ok("fbPhotoStory", "FS"),
      uploadFacebookVideoStory: ok("fbStoryUpload", "VS"),
      publishFacebookVideoStory: ok("fbStory", "VS"),
    },
  };
  return { d, updates, calls };
}

describe("runReels with posts and stories", () => {
  it("prepares a post's Instagram container ahead, and posts Facebook only at its time", async () => {
    const { d, updates, calls } = deps([item({})]);
    await runReels(d, NOW);
    expect(calls).toEqual(["igPost"]);
    expect(updates[0]).toMatchObject({ ig_container_id: "CP" });
  });

  it("publishes a post on both networks at its time", async () => {
    const { d, updates, calls } = deps([item({ ig_container_id: "CP", prepared_at: "x" })]);
    const s = await runReels(d, AT);
    expect(calls).toEqual(["igPublish", "fbPhotos"]);
    expect(updates[0]).toMatchObject({ status: "done", fb_video_id: "FP" });
    expect(s.published).toBe(1);
  });

  it("uploads a video story to Facebook ahead, and finishes it at its time", async () => {
    const story = item({ kind: "story", media: [{ path: "meta/v.mp4", type: "video" }] });
    const first = deps([story]);
    await runReels(first.d, NOW);
    expect(first.calls).toEqual(["igStory", "fbStoryUpload"]);
    const later = deps([{ ...story, ig_container_id: "CS", fb_video_id: "VS", prepared_at: "x" }]);
    await runReels(later.d, AT);
    expect(later.calls).toEqual(["igPublish", "fbStory"]);
  });

  it("posts a photo story on Facebook at its time, with nothing to upload ahead", async () => {
    const story = item({
      kind: "story",
      instagram: false,
      media: [{ path: "meta/a.jpg", type: "image" }],
    });
    const first = deps([story]);
    await runReels(first.d, NOW);
    expect(first.calls).toEqual([]);
    const later = deps([story]);
    await runReels(later.d, AT);
    expect(later.calls).toEqual(["fbPhotoStory"]);
    expect(later.updates[0]).toMatchObject({ status: "done" });
  });

  it("fails a network whose file is missing from storage, without calling Meta", async () => {
    const { d, updates, calls } = deps([item({})]);
    d.videoUrl = async () => null;
    await runReels(d, AT);
    expect(calls).toEqual([]);
    expect(updates[0]).toMatchObject({ status: "failed" });
  });
});
