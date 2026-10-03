"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { scrollFocusedItemIntoView } from "./focus-scroll-list";
import { ProductImage } from "./product-image";
import { autoplayVideo, mayAutoplayVideo, ProductVideo, VIDEO_LABEL } from "./product-video";

const MAX_IMAGES = 8;

/**
 * The main slot: square, and on wide screens never taller than the window leaves room for (the
 * gallery column is sticky there, so its thumbnails must stay on screen).
 */
const MAIN = "aspect-square w-full rounded-composer lg:max-h-[calc(100svh-15rem)]";

export interface GalleryVideo {
  src: string;
  /** The poster (videoPosterSrc), or undefined when the product has no usable photo. */
  poster: string | undefined;
}

export type GalleryItem =
  { kind: "video"; video: GalleryVideo } | { kind: "image"; src: string; n: number };

/** The gallery's items in order: the video first when the product has one, then the photos. */
export function galleryItems(images: string[], video: GalleryVideo | null): GalleryItem[] {
  return [
    ...(video ? [{ kind: "video" as const, video }] : []),
    ...images.slice(0, MAX_IMAGES).map((src, i) => ({ kind: "image" as const, src, n: i + 1 })),
  ];
}

/**
 * Main slot and thumbnail buttons. With a video it is the first item and the one shown first, with
 * the product photo as its poster and the native controls. Once mounted it starts by itself, muted
 * and looping (owner request 2026-10-03), unless the visitor prefers reduced motion or saves data
 * (mayAutoplayVideo): then it waits for play, and nothing loads before that. Every thumbnail is a
 * button: Tab reaches it, Enter or Space shows it, aria-pressed says which one is shown. Leaving
 * the video (another thumbnail) removes it, which stops it; coming back to it starts it again.
 */
export function ProductGallery({
  images,
  alt,
  video = null,
}: {
  images: string[];
  alt: string;
  video?: GalleryVideo | null;
}) {
  const shown = images.slice(0, MAX_IMAGES);
  const count = shown.length;
  const items = galleryItems(images, video);
  const [index, setIndex] = useState(0);
  const current = items[Math.min(index, items.length - 1)] ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const showingVideo = current?.kind === "video";

  // After mount only, so the server HTML (poster, controls, no autoplay) never differs.
  useEffect(() => {
    const el = videoRef.current;
    if (showingVideo && el && mayAutoplayVideo(window)) autoplayVideo(el);
  }, [showingVideo]);

  return (
    <div className="space-y-2">
      {current?.kind === "video" ? (
        <ProductVideo
          ref={videoRef}
          src={current.video.src}
          poster={current.video.poster}
          className={MAIN}
        />
      ) : (
        <ProductImage
          src={current?.src}
          alt={count > 1 && current ? `${alt} (תמונה ${current.n} מתוך ${count})` : alt}
          className={MAIN}
          iconClassName="size-32"
          sizes="(min-width: 1152px) 528px, (min-width: 1024px) 45vw, 92vw"
          preload={!video && index === 0}
        />
      )}
      {items.length > 1 && (
        // One row that scrolls sideways on phones (a keyboard-focused thumbnail scrolls into view
        // whole), wrapped from sm. The padding keeps the focus ring inside the scrolling row.
        <ul
          aria-label="תמונות וסרטון של המוצר"
          onFocus={scrollFocusedItemIntoView}
          className="-mx-1.5 flex gap-2 overflow-x-auto scroll-px-1.5 p-1.5 sm:flex-wrap sm:overflow-visible"
        >
          {items.map((item, i) => {
            const selected = i === index;
            return (
              <li key={item.kind === "video" ? "video" : item.src} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={item.kind === "video" ? VIDEO_LABEL : `תמונה ${item.n} מתוך ${count}`}
                  aria-pressed={selected}
                  className={`relative block size-16 overflow-hidden rounded-tile border-2 ${
                    selected ? "border-accent" : "border-line hover:border-muted"
                  }`}
                >
                  <ProductImage
                    src={item.kind === "video" ? shown[0] : item.src}
                    alt=""
                    className="size-full"
                    iconClassName="size-6"
                    sizes="64px"
                  />
                  {item.kind === "video" && (
                    <span aria-hidden className="absolute inset-0 grid place-items-center">
                      <span className="grid size-8 place-items-center rounded-full bg-invert-bg/85 text-invert-ink">
                        {/* A play mark points right in RTL too: nudged right (physically) to
                            look centered. */}
                        <Play className="ml-0.5 size-4 fill-current" />
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {video && <p className="text-sm text-muted">הסרטון והתמונות מעמוד המוצר באלי אקספרס.</p>}
    </div>
  );
}
