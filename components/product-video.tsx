import { getImageProps } from "next/image";
import { isAllowedImage } from "@/lib/images";

/**
 * The product's video from AliExpress (product_video_url), played from AliExpress's CDN.
 * Nothing loads until the visitor presses play (preload="none"); the product photo is the poster,
 * served through the image optimizer like the gallery.
 */
export function ProductVideo({ src, poster }: { src: string; poster: string | undefined }) {
  const posterSrc =
    poster && isAllowedImage(poster)
      ? getImageProps({ src: poster, alt: "", width: 384, height: 384 }).props.src
      : undefined;
  return (
    <section aria-labelledby="video-title" className="space-y-3">
      <h2 id="video-title" className="font-display text-xl">
        סרטון המוצר
      </h2>
      <video
        src={src}
        poster={posterSrc}
        controls
        playsInline
        preload="none"
        aria-labelledby="video-title"
        className="aspect-video w-full rounded-card bg-white object-contain"
      >
        <p className="p-4 text-sm text-muted">הדפדפן לא יכול להציג את הסרטון.</p>
      </video>
      <p className="text-sm text-muted">הסרטון מעמוד המוצר באלי אקספרס.</p>
    </section>
  );
}
