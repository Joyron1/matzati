import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { fetchPhotoJpeg, toWhatsAppJpeg } from "./photo";

const AE = "https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg";
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** A real WebP, like the ones AliExpress serves under a ".jpg" address. */
const webp = (w = 1200, h = 900, channels: 3 | 4 = 3) =>
  sharp({
    create: { width: w, height: h, channels, background: { r: 200, g: 30, b: 30, alpha: 0.5 } },
  })
    .webp()
    .toBuffer();

describe("toWhatsAppJpeg", () => {
  it("turns WebP into a real JPEG no larger than 800 px", async () => {
    const out = await toWhatsAppJpeg(await webp(1200, 900));
    expect(isJpeg(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
    expect(meta.space).toBe("srgb");
  });
  it("does not enlarge a small photo, and flattens transparency onto white", async () => {
    const out = await toWhatsAppJpeg(await webp(300, 300, 4));
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(300);
    expect(meta.channels).toBe(3);
  });
  it("keeps a JPEG a JPEG", async () => {
    const jpeg = await sharp({
      create: { width: 50, height: 50, channels: 3, background: "#123456" },
    })
      .jpeg()
      .toBuffer();
    expect(isJpeg(await toWhatsAppJpeg(jpeg))).toBe(true);
  });
  it("rejects bytes that are not an image", async () => {
    await expect(toWhatsAppJpeg(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe("fetchPhotoJpeg", () => {
  const ok = async (body: Uint8Array) =>
    vi.fn(async () => new Response(body as BodyInit, { status: 200 })) as unknown as typeof fetch;

  it("fetches an AliExpress photo and returns a JPEG", async () => {
    const fetchFn = await ok(new Uint8Array(await webp()));
    const out = await fetchPhotoJpeg(AE, fetchFn);
    expect(out && isJpeg(out)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("never fetches another host, another scheme or nothing (no open proxy)", async () => {
    const fetchFn = await ok(new Uint8Array(await webp()));
    for (const src of [
      undefined,
      "",
      "https://evil.example/a.jpg",
      "http://ae-pic-a1.aliexpress-media.com/a.jpg",
      "file:///etc/passwd",
      "https://aliexpress-media.com.evil.example/a.jpg",
    ]) {
      expect(await fetchPhotoJpeg(src, fetchFn)).toBeNull();
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("returns null for an error status, an empty body, a huge body and junk", async () => {
    const status = vi.fn(
      async () => new Response("no", { status: 404 }),
    ) as unknown as typeof fetch;
    expect(await fetchPhotoJpeg(AE, status)).toBeNull();
    expect(await fetchPhotoJpeg(AE, await ok(new Uint8Array()))).toBeNull();
    expect(await fetchPhotoJpeg(AE, await ok(new Uint8Array(5_000_001)))).toBeNull();
    expect(await fetchPhotoJpeg(AE, await ok(new Uint8Array([1, 2, 3])))).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await fetchPhotoJpeg(AE, boom)).toBeNull();
  });
});
