import { describe, expect, it } from "vitest";
import { aliImageLoader, aliImageUrl, isAllowedImage } from "./images";

describe("aliImageUrl (AliExpress's resized copies, never Vercel's optimizer)", () => {
  const src = "https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg";

  it("picks the smallest CDN size at least as wide as asked", () => {
    expect(aliImageUrl(src, 200)).toBe(`${src}_220x220.jpg`);
    expect(aliImageUrl(src, 220)).toBe(`${src}_220x220.jpg`);
    expect(aliImageUrl(src, 384)).toBe(`${src}_480x480.jpg`);
    expect(aliImageUrl(src, 640)).toBe(`${src}_640x640.jpg`);
    expect(aliImageLoader({ src, width: 350 })).toBe(`${src}_350x350.jpg`);
  });

  it("serves the original past the largest copy, for PNG too", () => {
    expect(aliImageUrl(src, 750)).toBe(src);
    expect(aliImageUrl("https://ae-pic-a1.aliexpress-media.com/kf/S1.png", 300)).toBe(
      "https://ae-pic-a1.aliexpress-media.com/kf/S1.png_350x350.jpg",
    );
  });

  it("leaves other hosts and other file types alone", () => {
    expect(aliImageUrl("https://evil.example/S1.jpg", 300)).toBe("https://evil.example/S1.jpg");
    expect(aliImageUrl(`${src}.webp`, 300)).toBe(`${src}.webp`);
  });
});

describe("isAllowedImage", () => {
  it("accepts https photos on the AliExpress image CDN", () => {
    expect(isAllowedImage("https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg")).toBe(true);
    expect(isAllowedImage("https://ae01.alicdn.aliexpress-media.com/kf/S1.jpg")).toBe(true);
  });

  it("rejects other hosts, plain http and anything that is not a URL", () => {
    expect(isAllowedImage("http://ae-pic-a1.aliexpress-media.com/kf/S1.jpg")).toBe(false);
    expect(isAllowedImage("https://aliexpress-media.com.evil.example/S1.jpg")).toBe(false);
    expect(isAllowedImage("https://evil.example/ae-pic-a1.aliexpress-media.com/S1.jpg")).toBe(
      false,
    );
    expect(isAllowedImage("/kf/S1.jpg")).toBe(false);
    expect(isAllowedImage("")).toBe(false);
  });
});
