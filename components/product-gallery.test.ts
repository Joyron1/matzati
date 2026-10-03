// The product page's gallery (owner request 2026-10-03): the product's video is the first item and
// the one shown first, and it starts by itself (muted, looping) only when the visitor neither
// prefers reduced motion nor saves data. The server HTML never autoplays.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { galleryItems, ProductGallery } from "./product-gallery";
import { autoplayVideo, mayAutoplayVideo, VIDEO_LABEL } from "./product-video";

const IMAGES = [
  "https://ae01.alicdn.com/kf/S1.jpg",
  "https://ae01.alicdn.com/kf/S2.jpg",
  "https://ae01.alicdn.com/kf/S3.jpg",
];
const VIDEO = {
  src: "https://video.aliexpress-media.com/play/u/ae_sg_item/1/p/1/e/6/t/10301/1.mp4",
  poster: "https://ae01.alicdn.com/kf/S1.jpg_640x640.jpg",
};

describe("galleryItems", () => {
  it("puts the video first when the product has one", () => {
    const items = galleryItems(IMAGES, VIDEO);
    expect(items.map((i) => i.kind)).toEqual(["video", "image", "image", "image"]);
    expect(items[0]).toEqual({ kind: "video", video: VIDEO });
  });

  it("is only the photos without a video", () => {
    expect(galleryItems(IMAGES, null).map((i) => i.kind)).toEqual(["image", "image", "image"]);
  });
});

describe("ProductGallery", () => {
  it("shows the video in the main slot and as the first thumbnail, with no autoplay in the HTML", () => {
    const out = renderToStaticMarkup(
      createElement(ProductGallery, { images: IMAGES, alt: "מוצר", video: VIDEO }),
    );
    const main = out.indexOf("<video");
    expect(main).toBeGreaterThanOrEqual(0);
    expect(main).toBeLessThan(out.indexOf("<ul"));
    expect(out).toContain(`poster="${VIDEO.poster}"`);
    expect(out).toContain("controls");
    expect(out).toContain('preload="none"');
    expect(out).not.toMatch(/autoplay/i);
    const buttons = [
      ...out.matchAll(/<button [^>]*aria-label="([^"]+)"[^>]*aria-pressed="(\w+)"/g),
    ];
    expect(buttons[0]?.[1]).toBe(VIDEO_LABEL);
    expect(buttons[0]?.[2]).toBe("true");
    expect(buttons).toHaveLength(IMAGES.length + 1);
  });

  it("shows the first photo without a video", () => {
    const out = renderToStaticMarkup(
      createElement(ProductGallery, { images: IMAGES, alt: "מוצר", video: null }),
    );
    expect(out).not.toContain("<video");
  });
});

const env = (reduce: boolean, saveData?: boolean) => ({
  matchMedia: (q: string) => ({ matches: reduce && q === "(prefers-reduced-motion: reduce)" }),
  navigator: saveData === undefined ? {} : { connection: { saveData } },
});

describe("mayAutoplayVideo", () => {
  it("allows autoplay by default, also where the browser has no connection info", () => {
    expect(mayAutoplayVideo(env(false))).toBe(true);
    expect(mayAutoplayVideo(env(false, false))).toBe(true);
  });

  it("never autoplays under reduced motion", () => {
    expect(mayAutoplayVideo(env(true))).toBe(false);
    expect(mayAutoplayVideo(env(true, false))).toBe(false);
  });

  it("never autoplays on a connection that saves data", () => {
    expect(mayAutoplayVideo(env(false, true))).toBe(false);
  });
});

describe("autoplayVideo", () => {
  it("plays muted and looping, and a refused play leaves it alone", async () => {
    const play = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    const video = { muted: false, loop: false, play } as unknown as HTMLVideoElement;
    autoplayVideo(video);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    await Promise.resolve();
  });
});
