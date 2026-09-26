import Image from "next/image";
import { ImageOff, type LucideIcon } from "lucide-react";

interface ProductImageProps {
  src: string | undefined;
  alt: string;
  /** Artwork shown when there is no image (mock data in M1). */
  fallbackIcon?: LucideIcon;
  className?: string;
  iconClassName?: string;
  sizes?: string;
  priority?: boolean;
}

// TODO(M2): add AliExpress image hosts to next.config `images.remotePatterns`
// once the real hostnames are confirmed from saved API fixtures.
export function ProductImage({
  src,
  alt,
  fallbackIcon: Icon = ImageOff,
  className = "",
  iconClassName = "size-10",
  sizes = "(min-width: 1024px) 40vw, 90vw",
  priority,
}: ProductImageProps) {
  if (src) {
    return (
      // Product photos are mostly shot on white; contain avoids cropping the product.
      <div className={`relative overflow-hidden bg-white ${className}`}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
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
      <Icon className={iconClassName} strokeWidth={1.5} />
    </div>
  );
}
