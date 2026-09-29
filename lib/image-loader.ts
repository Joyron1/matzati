// The next/image loader for the whole site (images.loaderFile in next.config.ts): AliExpress's
// resized copies, never Vercel's image optimizer (lib/images.ts says why). Registered in the
// config because a server component cannot pass a function to next/image's `loader` prop.
import { aliImageUrl } from "./images";

export default function imageLoader({ src, width }: { src: string; width: number }): string {
  return aliImageUrl(src, width);
}
