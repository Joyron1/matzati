import Image from "next/image";
import { ImageOff } from "lucide-react";
// next/image throws on a host outside images.remotePatterns, so an unexpected URL falls back to
// the placeholder instead of breaking the page. The photo comes from AliExpress's own resized
// copies (lib/image-loader.ts, the site's next/image loader), never from Vercel's image optimizer
// (its Hobby quota: lib/images.ts).
import { isAllowedImage } from "@/lib/images";

interface ProductImageProps {
  src: string | undefined;
  alt: string;
  className?: string;
  iconClassName?: string;
  sizes?: string;
  /** For the images likely to be the largest paint on the page: eager, high fetch priority. */
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
          // Fetched first and at high priority (Next 16 prefers this to `preload`): otherwise
          // the browser and Lighthouse's simulation queue the photo behind fonts and scripts.
          {...(preload ? { loading: "eager", fetchPriority: "high" } : {})}
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
