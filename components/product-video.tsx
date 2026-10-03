import type { Ref } from "react";
import { aliImageUrl, isAllowedImage } from "@/lib/images";

export const VIDEO_LABEL = "סרטון המוצר";

/**
 * The poster for the product video: AliExpress's 640 px copy of the product photo (the gallery's
 * main slot is about 540 px wide; lib/images.ts), or undefined.
 */
export function videoPosterSrc(photo: string | undefined): string | undefined {
  if (!photo || !isAllowedImage(photo)) return undefined;
  return aliImageUrl(photo, 640);
}

/** What the browser tells about the visitor's settings, for mayAutoplayVideo. */
export interface AutoplayEnvironment {
  matchMedia: (query: string) => { matches: boolean };
  /** navigator.connection is not in every browser (nor in TypeScript's DOM types). */
  navigator: object;
}

type WithConnection = { connection?: { saveData?: boolean } };

/**
 * Whether the product video may start by itself (owner request 2026-10-03): never under
 * prefers-reduced-motion (WCAG 2.2.2, CLAUDE.md §9) and never on a connection that asks to save
 * data (Save-Data, navigator.connection.saveData, where the browser exposes it). Checked in the
 * browser after mount only, so the server HTML (poster and controls) is the same for everyone.
 */
export function mayAutoplayVideo(env: AutoplayEnvironment): boolean {
  if (env.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return (env.navigator as WithConnection).connection?.saveData !== true;
}

/**
 * Starts the video muted and looping (browsers allow only muted autoplay), when mayAutoplayVideo
 * allows it; a refusal by the browser leaves the poster and the controls.
 */
export function autoplayVideo(video: HTMLVideoElement) {
  video.muted = true;
  video.loop = true;
  void video.play().catch(() => {});
}

/**
 * The product's video from AliExpress (product_video_url), played from AliExpress's CDN in the
 * gallery's main slot, with the native controls (they work with the keyboard; the visitor unmutes
 * or pauses there). The server HTML has no autoplay: nothing loads before the gallery starts it
 * (autoplayVideo, muted, after mayAutoplayVideo) or the visitor presses play (preload="none").
 */
export function ProductVideo({
  src,
  poster,
  className = "",
  ref,
}: {
  src: string;
  poster: string | undefined;
  className?: string;
  ref?: Ref<HTMLVideoElement>;
}) {
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      controls
      playsInline
      preload="none"
      aria-label={VIDEO_LABEL}
      className={`bg-white object-contain ${className}`}
    >
      <p className="p-4 text-sm text-muted">הדפדפן לא יכול להציג את הסרטון.</p>
    </video>
  );
}
