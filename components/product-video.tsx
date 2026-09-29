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

/**
 * The product's video from AliExpress (product_video_url), played from AliExpress's CDN in the
 * gallery's main slot. Nothing loads until the visitor presses play (preload="none") and nothing
 * plays by itself; the native controls work with the keyboard.
 */
export function ProductVideo({
  src,
  poster,
  className = "",
}: {
  src: string;
  poster: string | undefined;
  className?: string;
}) {
  return (
    <video
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
