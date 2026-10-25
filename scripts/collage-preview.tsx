// Dev only: renders the search group's collage from five product photos to a file, to look at it.
//   npx tsx --conditions=react-server scripts/collage-preview.tsx <out.jpg> <url>...
import { writeFileSync } from "node:fs";
import { collageImage } from "@/lib/og/card";
import { imageDataUri } from "@/lib/og/image";

async function main() {
  const [out, ...urls] = process.argv.slice(2);
  const photos = await Promise.all(urls.map((u) => imageDataUri(u)));
  console.log("photos read:", photos.filter(Boolean).length, "of", urls.length);
  writeFileSync(out, await collageImage(photos));
  console.log("wrote", out);
}

void main();
