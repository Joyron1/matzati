import { describe, expect, it, vi } from "vitest";
import type { MetaConfig, MetaResult } from "./publish";
import {
  createInstagramReel,
  instagramContainerStatus,
  publishFacebookReel,
  uploadFacebookReel,
} from "./reels";
import { finalStatus, PREPARE_AHEAD_MS, runReels, type Reel, type ReelsDeps } from "./reels-run";
import { fromIsraelLocal, reelTimeLabel, toIsraelLocal } from "./reels-time";

const CONFIG: MetaConfig = {
  pageId: "111",
  token: "SECRET-TOKEN",
  igUserId: "222",
  version: "v26.0",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Meta's Reel calls", () => {
  it("creates an Instagram Reel container with the token only in a header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ id: "C1" }));
    const r = await createInstagramReel(
      CONFIG,
      { videoUrl: "https://x/v.mp4", caption: "שלום" },
      fetchMock,
    );
    expect(r).toEqual({ ok: true, id: "C1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://graph.facebook.com/v26.0/222/media");
    expect(String(url)).not.toContain("SECRET");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe("https://x/v.mp4");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer SECRET-TOKEN");
  });

  it("reads a container's status and never leaks the token in an error", async () => {
    expect(
      await instagramContainerStatus(
        CONFIG,
        "C1",
        vi.fn(async () => json({ status_code: "FINISHED" })),
      ),
    ).toEqual({ ok: true, status: "FINISHED" });
    const bad = await instagramContainerStatus(
      CONFIG,
      "C1",
      vi.fn(async () => json({ error: { message: "bad token SECRET-TOKEN" } }, 400)),
    );
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("SECRET-TOKEN");
  });

  it("uploads a Facebook Reel in two steps: start, then Meta fetches the file", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ video_id: "V9", upload_url: "x" }))
      .mockResolvedValueOnce(json({ success: true }));
    const r = await uploadFacebookReel(CONFIG, "https://x/v.mp4", fetchMock);
    expect(r).toEqual({ ok: true, id: "V9" });
    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(String(startUrl)).toBe("https://graph.facebook.com/v26.0/111/video_reels");
    expect(new URLSearchParams(String(startInit?.body)).get("upload_phase")).toBe("start");
    const [upUrl, upInit] = fetchMock.mock.calls[1];
    expect(String(upUrl)).toBe("https://rupload.facebook.com/video-upload/v26.0/V9");
    const headers = upInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("OAuth SECRET-TOKEN");
    expect(headers.file_url).toBe("https://x/v.mp4");
  });

  it("publishes a Facebook Reel with video_state PUBLISHED and its description", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ success: true }));
    const r = await publishFacebookReel(CONFIG, { videoId: "V9", description: "כיתוב" }, fetchMock);
    expect(r).toEqual({ ok: true, id: "V9" });
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get("upload_phase")).toBe("finish");
    expect(body.get("video_state")).toBe("PUBLISHED");
    expect(body.get("description")).toBe("כיתוב");
  });
});

const NOW = new Date("2026-10-26T16:30:00Z"); // 19:30 Israel (UTC+2 after 25.10)

function reel(o: Partial<Reel> = {}): Reel {
  return {
    id: "r1",
    video_path: "reels/a.mp4",
    caption: "כיתוב",
    scheduled_at: "2026-10-26T18:00:00Z",
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

function deps(reels: Reel[], meta: Partial<ReelsDeps["meta"]> = {}) {
  const updates: Record<string, unknown>[] = [];
  const ok = (id: string): MetaResult => ({ ok: true, id });
  const d: ReelsDeps = {
    scheduledBefore: async () => reels,
    update: async (_id, patch) => void updates.push(patch),
    notifyManual: async () => ({ ok: true }),
    videoUrl: async () => "https://signed/v.mp4",
    meta: {
      createInstagramReel: async () => ok("C1"),
      instagramContainerStatus: async () => ({ ok: true, status: "FINISHED" }),
      publishInstagramContainer: async () => ok("M1"),
      uploadFacebookReel: async () => ok("V1"),
      publishFacebookReel: async () => ok("V1"),
      createInstagramPost: async () => ok("CP"),
      createInstagramStory: async () => ok("CS"),
      publishFacebookPhotos: async () => ok("FP"),
      publishFacebookPhotoStory: async () => ok("FS"),
      uploadFacebookVideoStory: async () => ok("VS"),
      publishFacebookVideoStory: async () => ok("VS"),
      ...meta,
    },
  };
  return { d, updates };
}

describe("runReels", () => {
  it("prepares a Reel within the hour before its time, and does not publish it yet", async () => {
    const { d, updates } = deps([reel()]);
    const s = await runReels(d, NOW);
    expect(s).toEqual({ prepared: 1, published: 0, failed: 0 });
    expect(updates[0]).toMatchObject({ ig_container_id: "C1", fb_video_id: "V1" });
    expect(updates[0]).not.toHaveProperty("status");
  });

  it("publishes a prepared Reel on both networks once its time has come", async () => {
    const at = new Date("2026-10-26T18:00:00Z");
    const { d, updates } = deps([
      reel({ prepared_at: NOW.toISOString(), ig_container_id: "C1", fb_video_id: "V1" }),
    ]);
    const s = await runReels(d, at);
    expect(s).toEqual({ prepared: 0, published: 1, failed: 0 });
    expect(updates[0]).toMatchObject({ ig_media_id: "M1", status: "done" });
    expect(updates[0]).toHaveProperty("fb_posted_at");
  });

  it("waits for Instagram's processing and posts Facebook meanwhile", async () => {
    const at = new Date("2026-10-26T18:00:00Z");
    const { d, updates } = deps(
      [reel({ prepared_at: NOW.toISOString(), ig_container_id: "C1", fb_video_id: "V1" })],
      { instagramContainerStatus: async () => ({ ok: true, status: "IN_PROGRESS" }) },
    );
    await runReels(d, at);
    expect(updates[0]).toHaveProperty("fb_posted_at");
    expect(updates[0]).not.toHaveProperty("status");
  });

  it("keeps one network's failure from the other: partial", async () => {
    const at = new Date("2026-10-26T18:00:00Z");
    const { d, updates } = deps(
      [reel({ prepared_at: NOW.toISOString(), ig_container_id: "C1", fb_video_id: "V1" })],
      { publishFacebookReel: async () => ({ ok: false, error: "finish: Meta 400: bad" }) },
    );
    const s = await runReels(d, at);
    expect(s.published).toBe(1);
    expect(updates[0]).toMatchObject({ status: "partial", fb_error: "finish: Meta 400: bad" });
  });

  it("asks for Reels up to an hour ahead", async () => {
    const asked: Date[] = [];
    const { d } = deps([]);
    d.scheduledBefore = async (until) => {
      asked.push(until);
      return [];
    };
    await runReels(d, NOW);
    expect(asked[0].getTime() - NOW.getTime()).toBe(PREPARE_AHEAD_MS);
  });

  it("finalStatus: done, partial, failed, or still waiting", () => {
    expect(finalStatus(reel({ ig_posted_at: "x", fb_posted_at: "x" }))).toBe("done");
    expect(finalStatus(reel({ ig_posted_at: "x", fb_error: "e" }))).toBe("partial");
    expect(finalStatus(reel({ ig_error: "e", fb_error: "e" }))).toBe("failed");
    expect(finalStatus(reel({ facebook: false, ig_posted_at: "x" }))).toBe("done");
    expect(finalStatus(reel({ ig_posted_at: "x" }))).toBe("scheduled");
  });
});

describe("Reel times (Israel)", () => {
  it("reads and writes Israel wall-clock times across the clock change", () => {
    // 26.10 is after the change to winter time (UTC+2).
    expect(fromIsraelLocal("2026-10-26T20:00")?.toISOString()).toBe("2026-10-26T18:00:00.000Z");
    expect(fromIsraelLocal("2026-10-23T20:00")?.toISOString()).toBe("2026-10-23T17:00:00.000Z");
    expect(toIsraelLocal(new Date("2026-10-26T18:00:00Z"))).toBe("2026-10-26T20:00");
    expect(fromIsraelLocal("2026-11-31T20:00")).toBeNull();
    expect(fromIsraelLocal("nope")).toBeNull();
    expect(reelTimeLabel(new Date("2026-10-26T18:00:00Z"))).toBe("יום שני 26.10 בשעה 20:00");
  });
});
