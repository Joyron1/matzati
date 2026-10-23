import { describe, expect, it } from "vitest";
import { allowedMediaUrl, mediaFileName } from "./media";

describe("admin media downloads", () => {
  it("fetches only AliExpress's media hosts over https", () => {
    expect(allowedMediaUrl("https://ae01.alicdn.com/kf/a.jpg")?.hostname).toBe("ae01.alicdn.com");
    expect(allowedMediaUrl("https://video.aliexpress-media.com/play/u/1.mp4")).not.toBeNull();
    expect(allowedMediaUrl("http://ae01.alicdn.com/kf/a.jpg")).toBeNull();
    expect(allowedMediaUrl("https://evil.com/?x=.alicdn.com")).toBeNull();
    expect(allowedMediaUrl("https://alicdn.com.evil.com/a.jpg")).toBeNull();
    expect(allowedMediaUrl("https://169.254.169.254/latest")).toBeNull();
    expect(allowedMediaUrl("not a url")).toBeNull();
  });

  it("names the file safely", () => {
    const url = new URL("https://ae01.alicdn.com/kf/photo.jpg");
    expect(mediaFileName("1005-1.jpg", url)).toBe("1005-1.jpg");
    expect(mediaFileName('a"; rm.jpg', url)).toBe("a___rm.jpg");
    expect(mediaFileName(null, url)).toBe("photo.jpg");
  });
});
