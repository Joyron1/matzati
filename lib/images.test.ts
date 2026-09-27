import { describe, expect, it } from "vitest";
import { isAllowedImage } from "./images";

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
