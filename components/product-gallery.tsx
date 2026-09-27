"use client";

import { useState } from "react";
import { ProductImage } from "./product-image";

const MAX_IMAGES = 8;

/** Main product photo with thumbnail buttons for the rest of the AliExpress images. */
export function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const shown = images.slice(0, MAX_IMAGES);
  const [index, setIndex] = useState(0);
  const count = shown.length;

  return (
    <div className="space-y-3">
      <ProductImage
        src={shown[index]}
        alt={count > 1 ? `${alt} (תמונה ${index + 1} מתוך ${count})` : alt}
        className="aspect-square w-full rounded-composer"
        iconClassName="size-32"
        sizes="(min-width: 1152px) 540px, (min-width: 1024px) 45vw, 92vw"
        preload={index === 0}
      />
      {count > 1 && (
        <ul aria-label="תמונות המוצר" className="flex flex-wrap gap-2">
          {shown.map((src, i) => {
            const current = i === index;
            return (
              <li key={src}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`תמונה ${i + 1} מתוך ${count}`}
                  aria-pressed={current}
                  className={`block size-16 overflow-hidden rounded-tile border-2 ${
                    current ? "border-accent" : "border-line hover:border-muted"
                  }`}
                >
                  <ProductImage src={src} alt="" className="size-full" sizes="64px" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
