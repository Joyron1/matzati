"use client";

// The candidate's photos and video as a gallery (owner request 2026-10-27: see them, not only
// download them). Thumbnails; a click opens one large in a native modal <dialog> above the drawer,
// with previous / next (buttons, the arrow keys, RTL: the next is on the left), a counter and the
// download link. Escape or the backdrop closes it, focus returns to the thumbnail.
import { ChevronLeft, ChevronRight, Download, Play, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

export interface GalleryItem {
  type: "image" | "video";
  src: string;
  /** /api/admin/media?… : downloads the file. */
  download: string;
}

export function MediaGallery({ items, title }: { items: GalleryItem[]; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  // The large view is rendered only while open: a video in it plays (autoPlay), and rendered in the
  // closed dialog it played as the page loaded (owner report 2026-10-27, "a sound on load").
  const [isOpen, setIsOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);

  const open = (i: number, button: HTMLButtonElement) => {
    opener.current = button;
    setIndex(i);
    setIsOpen(true);
    ref.current?.showModal();
  };
  const go = useCallback(
    (step: number) => setIndex((i) => (i + step + items.length) % items.length),
    [items.length],
  );
  const item = items[index];

  return (
    <>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {items.map((it, i) => (
          <li key={it.src}>
            <button
              type="button"
              onClick={(e) => open(i, e.currentTarget)}
              aria-label={`${it.type === "video" ? "הסרטון" : `תמונה ${i + 1}`}: הגדלה`}
              className="relative block aspect-square w-full overflow-hidden rounded-lg border border-line bg-surface-2 hover:border-muted"
            >
              {it.type === "video" ? (
                <span className="grid size-full place-items-center bg-ink text-invert-ink">
                  <Play aria-hidden className="size-6" />
                </span>
              ) : (
                // AliExpress's photo itself (the admin's view): next/image's loader is for cards.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.src} alt="" loading="lazy" className="size-full object-cover" />
              )}
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={ref}
        aria-label={`${title}: גלריה`}
        onClose={() => {
          setIsOpen(false);
          opener.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        onKeyDown={(e) => {
          // RTL: the left arrow is "next".
          if (e.key === "ArrowLeft") go(1);
          if (e.key === "ArrowRight") go(-1);
        }}
        className="m-auto max-h-[94dvh] w-[min(94vw,56rem)] max-w-none overflow-hidden rounded-[16px] bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/80"
      >
        {isOpen && item && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <span className="text-sm font-semibold">
                <bdi dir="ltr">
                  {index + 1} / {items.length}
                </bdi>
              </span>
              <div className="flex items-center gap-1">
                <a
                  href={item.download}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-accent-ink hover:bg-surface-2"
                >
                  <Download aria-hidden className="size-4" />
                  הורדה
                </a>
                <button
                  type="button"
                  aria-label="סגירה"
                  onClick={() => ref.current?.close()}
                  className="grid size-11 place-items-center rounded-lg hover:bg-surface-2"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>
            </div>
            <div className="relative grid min-h-[50dvh] place-items-center bg-black">
              {item.type === "video" ? (
                <video
                  key={item.src}
                  src={item.src}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[78dvh] w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={item.src}
                  src={item.src}
                  alt={`תמונה ${index + 1}`}
                  className="max-h-[78dvh] w-full object-contain"
                />
              )}
              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="הקודמת"
                    onClick={() => go(-1)}
                    className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-surface/90 text-ink shadow hover:bg-surface"
                  >
                    <ChevronRight aria-hidden className="size-6" />
                  </button>
                  <button
                    type="button"
                    aria-label="הבאה"
                    onClick={() => go(1)}
                    className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-surface/90 text-ink shadow hover:bg-surface"
                  >
                    <ChevronLeft aria-hidden className="size-6" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
