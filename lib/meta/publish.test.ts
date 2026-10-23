import { describe, expect, it, vi } from "vitest";
import {
  facebookMessage,
  IG_CAPTION_MAX,
  INSTAGRAM_LINK_NOTE,
  instagramCaption,
  instagramImage,
  META_DISCLOSURE,
  metaConfig,
  publishFacebook,
  publishInstagram,
  type MetaConfig,
} from "./publish";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const CONFIG: MetaConfig = {
  pageId: "123",
  token: "SECRET-PAGE-TOKEN",
  igUserId: "1784",
  version: "v26.0",
};
const POST = { productId: "1005001", postHe: "מכונית שלט רחוק לילדים\n💰 ₪81.39" };

function graph(answers: { status?: number; body: unknown }[]) {
  const calls: { url: string; params: URLSearchParams; auth: string | null }[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    calls.push({
      url: String(url),
      params: new URLSearchParams(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  });
  return { fetchMock, calls };
}

describe("meta config", () => {
  it("is off until the Page id and token are set; Instagram needs its own id", () => {
    expect(metaConfig(env({}))).toBeNull();
    expect(metaConfig(env({ META_PAGE_ID: "1" }))).toBeNull();
    expect(metaConfig(env({ META_PAGE_ID: "1", META_PAGE_ACCESS_TOKEN: "t" }))).toEqual({
      pageId: "1",
      token: "t",
      igUserId: null,
      version: "v26.0",
    });
    expect(
      metaConfig(
        env({ META_PAGE_ID: "1", META_PAGE_ACCESS_TOKEN: "t", META_GRAPH_VERSION: "nope" }),
      )?.version,
    ).toBe("v26.0");
  });
});

describe("meta texts", () => {
  it("adds the disclosure to every post; Instagram points to the profile's link", () => {
    expect(facebookMessage(POST.postHe)).toContain(META_DISCLOSURE);
    const caption = instagramCaption(POST.postHe);
    expect(caption).toContain(INSTAGRAM_LINK_NOTE);
    expect(caption).toContain(META_DISCLOSURE);
    expect(instagramCaption("א".repeat(5000)).length).toBeLessThanOrEqual(IG_CAPTION_MAX);
  });

  it("gives Instagram a JPEG: the product's photo, else our Open Graph card", () => {
    expect(instagramImage("1", "https://ae01.alicdn.com/kf/a.jpg")).toBe(
      "https://ae01.alicdn.com/kf/a.jpg",
    );
    expect(instagramImage("1", "https://ae01.alicdn.com/kf/a.png")).toBe(
      "https://www.matzati-il.com/p/1/opengraph-image",
    );
    expect(instagramImage("1", undefined)).toBe("https://www.matzati-il.com/p/1/opengraph-image");
  });
});

describe("publishFacebook", () => {
  it("posts the text with a link to our product page, the token in a header only", async () => {
    const { fetchMock, calls } = graph([{ body: { id: "123_456" } }]);
    await expect(publishFacebook(CONFIG, POST, fetchMock)).resolves.toEqual({
      ok: true,
      id: "123_456",
    });
    expect(calls[0].url).toBe("https://graph.facebook.com/v26.0/123/feed");
    expect(calls[0].params.get("link")).toBe("https://www.matzati-il.com/p/1005001");
    expect(calls[0].params.get("message")).toContain(META_DISCLOSURE);
    expect(calls[0].auth).toBe("Bearer SECRET-PAGE-TOKEN");
    expect(calls[0].url).not.toContain("SECRET");
  });

  it("returns Meta's reason without the token", async () => {
    const { fetchMock } = graph([
      { status: 400, body: { error: { message: "Invalid token SECRET-PAGE-TOKEN", code: 190 } } },
    ]);
    const r = await publishFacebook(CONFIG, POST, fetchMock);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRET-PAGE-TOKEN");
  });
});

describe("publishInstagram", () => {
  it("creates the container, then publishes it", async () => {
    const { fetchMock, calls } = graph([{ body: { id: "c1" } }, { body: { id: "m1" } }]);
    const r = await publishInstagram(
      CONFIG,
      { ...POST, photoUrl: "https://ae01.alicdn.com/kf/a.jpg" },
      fetchMock,
      0,
    );
    expect(r).toEqual({ ok: true, id: "m1" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://graph.facebook.com/v26.0/1784/media",
      "https://graph.facebook.com/v26.0/1784/media_publish",
    ]);
    expect(calls[0].params.get("image_url")).toBe("https://ae01.alicdn.com/kf/a.jpg");
    expect(calls[1].params.get("creation_id")).toBe("c1");
  });

  it("publishes again while Meta says the media is not ready, at most 3 times", async () => {
    const notReady = {
      status: 400,
      body: { error: { message: "not ready", error_subcode: 2207027 } },
    };
    const ok = graph([{ body: { id: "c1" } }, notReady, { body: { id: "m1" } }]);
    await expect(publishInstagram(CONFIG, POST, ok.fetchMock, 0)).resolves.toEqual({
      ok: true,
      id: "m1",
    });
    const never = graph([{ body: { id: "c1" } }, notReady]);
    const r = await publishInstagram(CONFIG, POST, never.fetchMock, 0);
    expect(r.ok).toBe(false);
    expect(never.calls).toHaveLength(4); // the container and 3 publish attempts
  });

  it("does nothing without the Instagram account's id", async () => {
    const { fetchMock } = graph([{ body: {} }]);
    const r = await publishInstagram({ ...CONFIG, igUserId: null }, POST, fetchMock, 0);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
