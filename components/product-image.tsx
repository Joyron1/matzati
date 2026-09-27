import Image from "next/image";
import { ImageOff } from "lucide-react";

// Mirrors images.remotePatterns in next.config.ts: next/image throws on any other host, so an
// unexpected URL falls back to the placeholder instead of breaking the page.
const IMAGE_HOST_SUFFIX = ".aliexpress-media.com";

function isAllowedImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.endsWith(IMAGE_HOST_SUFFIX);
  } catch {
    return false;
  }
}

interface ProductImageProps {
  src: string | undefined;
  alt: string;
  className?: string;
  iconClassName?: string;
  sizes?: string;
  /** For the one image that is likely the largest paint on the page. */
  preload?: boolean;
}

export function ProductImage({
  src,
  alt,
  className = "",
  iconClassName = "size-10",
  sizes = "(min-width: 1024px) 40vw, 90vw",
  preload,
}: ProductImageProps) {
  if (src && isAllowedImage(src)) {
    return (
      // Product photos are mostly shot on white; contain avoids cropping the product.
      <div className={`relative overflow-hidden bg-white ${className}`}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          preload={preload}
          className="object-contain"
        />
      </div>
    );
  }
  return (
    <div
      className={`grid place-items-center bg-accent-soft text-accent-ink ${className}`}
      aria-hidden
    >
      <ImageOff className={iconClassName} strokeWidth={1.5} />
    </div>
  );
}
