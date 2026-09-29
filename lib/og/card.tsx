// The Open Graph cards (1200x630, next/og) that WhatsApp, Facebook, X and the like show for a
// shared link: the brand card (every page without its own), a product card (/p) and a list card
// (/s). Cards with product photos are sent as JPEG (sharp, owner decision 2026-09-29): as PNG they
// weigh 400-700 KB and WhatsApp may skip a preview image that large; as JPEG about 100 KB. Hebrew goes through ./bidi (the renderer draws every string left to right). Colors are the
// light theme's tokens (CLAUDE.md §9): an image has no CSS variables. Server only (reads fonts).
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/config/brand";
import { SITE_HOST } from "@/lib/config/site";
import { clip, isRtlText, ogWords } from "./bidi";
import { OG_SIZE } from "./size";

export { OG_SIZE };
/** The brand card: text and flat color, small and sharpest as PNG. */
export const OG_CONTENT_TYPE = "image/png";
/** Cards with product photos. */
export const OG_PHOTO_CONTENT_TYPE = "image/jpeg";

export type OgFormat = "png" | "jpeg";

const C = {
  bg: "#EEF1F5",
  surface: "#FFFFFF",
  ink: "#0F1B2D",
  muted: "#536076",
  line: "#D3DAE4",
  accent: "#2446D8",
  accentSoft: "#E2E7FC",
  gold: "#F2B43A",
  invertBg: "#0F1B2D",
  invertInk: "#F3F6FB",
  invertMuted: "#B9C3D6",
};

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));
// Read once per server instance (next/og docs: fonts do not depend on the request).
const fonts = Promise.all([
  font("SecularOne-Regular.ttf"),
  font("IBMPlexSansHebrew-Regular.ttf"),
  font("IBMPlexSansHebrew-Bold.ttf"),
]).then(([secular, regular, bold]) => [
  { name: "Secular", data: secular, weight: 400 as const, style: "normal" as const },
  { name: "Plex", data: regular, weight: 400 as const, style: "normal" as const },
  { name: "Plex", data: bold, weight: 700 as const, style: "normal" as const },
]);

interface TextProps {
  text: string;
  size: number;
  color: string;
  family?: "Secular" | "Plex";
  weight?: 400 | 700;
  /** Line height as a multiple of `size`. */
  leading?: number;
}

/**
 * A paragraph: Hebrew as right-to-left wrapping words in visual order, anything else as is. Cut
 * the text to its box before (clip): the renderer cannot clamp lines.
 */
function Text({ text, size, color, family = "Plex", weight = 400, leading = 1.25 }: TextProps) {
  const rtl = isRtlText(text);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: rtl ? "row-reverse" : "row",
        flexWrap: "wrap",
        fontFamily: family,
        fontWeight: weight,
        fontSize: size,
        lineHeight: leading,
        color,
      }}
    >
      {ogWords(text).map((word, i) => (
        <div key={i} style={{ display: "flex", [rtl ? "marginLeft" : "marginRight"]: size * 0.27 }}>
          {word}
        </div>
      ))}
    </div>
  );
}

/** The logo: the brand name with a marigold dot, as in the header. */
function Logo({ size, color }: { size: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.2 }}>
      <div
        style={{
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: 999,
          background: C.gold,
          marginTop: size * 0.12,
        }}
      />
      <Text text={BRAND.name} size={size} color={color} family="Secular" />
    </div>
  );
}

function Host({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", fontFamily: "Plex", fontSize: 26, color, letterSpacing: 0.5 }}>
      {SITE_HOST}
    </div>
  );
}

async function render(node: ReactNode, format: OgFormat): Promise<Response> {
  const png = new ImageResponse(node as React.ReactElement, { ...OG_SIZE, fonts: await fonts });
  if (format === "png") return png;
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const headers = new Headers(png.headers);
  headers.set("content-type", OG_PHOTO_CONTENT_TYPE);
  headers.delete("content-length");
  return new Response(new Uint8Array(jpeg), { status: 200, headers });
}

/** The site's card: logo, tagline, what it does, and the search box it is about. */
export async function brandCard(format: OgFormat = "png"): Promise<Response> {
  return render(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: C.invertBg,
        padding: "56px 72px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Logo size={64} color={C.invertInk} />
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 34 }}
      >
        <Text text={BRAND.tagline} size={76} color={C.invertInk} family="Secular" leading={1.1} />
        <div style={{ display: "flex", width: 900, justifyContent: "flex-end", marginTop: 18 }}>
          <Text text={BRAND.description} size={34} color={C.invertMuted} leading={1.4} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "auto",
          height: 104,
          borderRadius: 999,
          background: C.surface,
          padding: "0 16px 0 40px",
          border: `4px solid ${C.accent}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 72,
            padding: "0 44px",
            borderRadius: 999,
            background: C.accent,
          }}
        >
          <Text text="חיפוש" size={34} color={C.surface} weight={700} />
        </div>
        <Text text="אוזניות לריצה, עמידות למים, עד 100 ש״ח" size={34} color={C.muted} />
      </div>
      <div style={{ display: "flex", marginTop: 22 }}>
        <Host color={C.invertMuted} />
      </div>
    </div>,
    format,
  );
}

/** A product: its photo, its title and the brand. */
export async function productCard(input: {
  title: string;
  image: string | null;
}): Promise<Response> {
  return render(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: C.bg,
        padding: 48,
        gap: 48,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 534,
          height: 534,
          flexShrink: 0,
          borderRadius: 36,
          background: C.surface,
          border: `2px solid ${C.line}`,
          overflow: "hidden",
        }}
      >
        {input.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img only
          <img src={input.image} width={534} height={534} style={{ objectFit: "contain" }} alt="" />
        ) : (
          <Logo size={72} color={C.ink} />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: 1 }}>
        <Logo size={48} color={C.ink} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 36, width: "100%" }}>
          <Text text={clip(input.title, 78)} size={46} color={C.ink} weight={700} leading={1.3} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: "auto",
            height: 76,
            padding: "0 40px",
            borderRadius: 999,
            background: C.accent,
          }}
        >
          <Text text="מחיר, משוב של קונים ומכירות" size={30} color={C.surface} weight={700} />
        </div>
        <div style={{ display: "flex", marginTop: 20 }}>
          <Host color={C.muted} />
        </div>
      </div>
    </div>,
    "jpeg",
  );
}

/** A list page (an SEO landing page): its title, a line under it and up to 4 product photos. */
export async function listCard(input: {
  eyebrow: string;
  title: string;
  subtitle: string;
  images: string[];
}): Promise<Response> {
  const images = input.images.slice(0, 4);
  return render(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: C.bg,
        padding: "48px 64px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Host color={C.muted} />
        <Logo size={52} color={C.ink} />
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 20 }}
      >
        <div
          style={{
            display: "flex",
            padding: "6px 22px",
            borderRadius: 999,
            background: C.accentSoft,
          }}
        >
          <Text text={input.eyebrow} size={26} color={C.accent} weight={700} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, width: "100%" }}>
          <Text
            text={clip(input.title, 40)}
            size={images.length ? 64 : 80}
            color={C.ink}
            family="Secular"
            leading={1.15}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, width: "100%" }}>
          <Text text={clip(input.subtitle, 90)} size={30} color={C.muted} leading={1.35} />
        </div>
      </div>
      {images.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "row-reverse",
            gap: 24,
            marginTop: "auto",
          }}
        >
          {images.map((src, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 246,
                height: 200,
                borderRadius: 24,
                background: C.surface,
                border: `2px solid ${C.line}`,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img only */}
              <img src={src} width={196} height={196} style={{ objectFit: "contain" }} alt="" />
            </div>
          ))}
        </div>
      )}
    </div>,
    "jpeg",
  );
}
