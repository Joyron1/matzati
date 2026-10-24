"use server";

// The Meta panel's actions (owner requests 2026-10-24: Reels, then feed posts and stories, then
// editing and manual stories with a link sticker). Every action checks requireAdmin() first.
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { isQuietTime } from "@/lib/agents/schedule";
import { absoluteUrl } from "@/lib/config/site";
import { META_DISCLOSURE } from "@/lib/meta/publish";
import type { MetaKind, MetaMedia } from "@/lib/meta/reels-run";
import {
  cancelReel,
  insertReel,
  markManualPosted,
  signedReelUpload,
  updateReel,
} from "@/lib/meta/reels-server";
import { fromIsraelLocal, REEL_MIN_LEAD_MS, REEL_MAX_DAYS_AHEAD } from "@/lib/meta/reels-time";
import { productIdIn } from "@/lib/meta/sticker-link";
import { productForPage } from "@/lib/search/server";
import { confirmOwnerCode, newOwnerCode, unlinkOwner } from "@/lib/telegram/owner";

const PAGE = "/admin/meta";

function back(status: string, extra = ""): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?status=${status}${extra}`);
}

/** A signed upload URL for a new file: a Reel's video, or a post's or story's image or video. */
export async function metaUploadAction(
  kind: "reel" | "image" | "video",
): Promise<{ path: string; token: string } | null> {
  await requireAdmin();
  if (kind !== "reel" && kind !== "image" && kind !== "video") return null;
  return signedReelUpload(kind);
}

const mediaSchema = z
  .array(
    z
      .object({
        path: z.string().regex(/^meta\/[0-9a-f-]{36}\.(jpg|mp4)$/),
        type: z.enum(["image", "video"]),
      })
      .refine((m) => m.path.endsWith(m.type === "image" ? ".jpg" : ".mp4")),
  )
  .max(10);

const schema = z.object({
  kind: z.enum(["reel", "post", "story"]),
  videoPath: z.string(),
  media: z.string().max(4000),
  caption: z.string().trim().max(2100),
  when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  facebook: z.boolean(),
  instagram: z.boolean(),
  disclosure: z.boolean(),
  manual: z.boolean(),
  link: z.string().trim().max(500),
  cover: z.string(),
});

/**
 * The sticker's link: our /go link when the product can be loaded (an affiliate link, counted as
 * a click with src=story), else the pasted https link as it is.
 */
async function stickerLink(input: string): Promise<{ url: string; title: string | null } | null> {
  const id = productIdIn(input);
  if (id) {
    const data = await productForPage(id);
    if (data) {
      return {
        url: absoluteUrl(`/go/${encodeURIComponent(id)}?src=story`),
        title: (data.product.title_he || data.product.title_en).slice(0, 300),
      };
    }
  }
  try {
    const url = new URL(input);
    if (url.protocol === "https:") return { url: url.toString().slice(0, 500), title: null };
  } catch {
    // not a URL
  }
  return null;
}

interface Parsed {
  kind: MetaKind;
  media: MetaMedia[];
  videoPath: string | null;
  coverPath: string | null;
  caption: string;
  scheduledAt: Date;
  facebook: boolean;
  instagram: boolean;
  manual: boolean;
  linkUrl: string | null;
  linkTitle: string | null;
}

/** The form's fields, checked; redirects back with a status on any problem. */
async function parseForm(formData: FormData, back_: (s: string) => never): Promise<Parsed> {
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    videoPath: formData.get("videoPath") ?? "",
    media: formData.get("media") ?? "[]",
    caption: formData.get("caption") ?? "",
    when: formData.get("when"),
    facebook: formData.get("facebook") === "on",
    instagram: formData.get("instagram") === "on",
    disclosure: formData.get("disclosure") === "on",
    manual: formData.get("manual") === "on",
    link: formData.get("link") ?? "",
    cover: formData.get("cover") ?? "",
  });
  if (!parsed.success) back_("invalid");
  const r = parsed.data;
  if (!r.facebook && !r.instagram) back_("no-network");

  let media: MetaMedia[] = [];
  let videoPath: string | null = null;
  let coverPath: string | null = null;
  if (r.kind === "reel") {
    if (!/^reels\/[0-9a-f-]{36}\.mp4$/.test(r.videoPath)) back_("no-media");
    videoPath = r.videoPath;
    if (r.cover) {
      if (!/^meta\/[0-9a-f-]{36}\.jpg$/.test(r.cover)) back_("invalid");
      coverPath = r.cover;
    }
  } else {
    let raw: unknown = null;
    try {
      raw = JSON.parse(r.media);
    } catch {
      back_("invalid");
    }
    const m = mediaSchema.safeParse(raw);
    if (!m.success) back_("invalid");
    media = m.data;
    if (!media.length) back_("no-media");
    // A post is images only (a video post is a Reel); a story is one image or one video.
    if (r.kind === "post" && media.some((x) => x.type !== "image")) back_("invalid");
    if (r.kind === "story" && media.length !== 1) back_("invalid");
  }
  // Stories have no caption on either network.
  if (r.kind !== "story" && !r.caption) back_("no-caption");

  const manual = r.kind === "story" && r.manual;
  let link: { url: string; title: string | null } | null = null;
  if (manual) {
    if (!r.link) back_("no-link");
    link = await stickerLink(r.link);
    if (!link) back_("bad-link");
  }

  const at = fromIsraelLocal(r.when);
  const now = Date.now();
  if (!at || at.getTime() < now + REEL_MIN_LEAD_MS) back_("too-soon");
  if (at.getTime() > now + REEL_MAX_DAYS_AHEAD * 24 * 60 * 60_000) back_("too-far");
  if (isQuietTime(at)) back_("quiet");
  return {
    kind: r.kind,
    media,
    videoPath,
    coverPath,
    caption:
      r.kind === "story" ? "" : r.disclosure ? `${r.caption}\n\n${META_DISCLOSURE}` : r.caption,
    scheduledAt: at,
    facebook: r.facebook,
    instagram: r.instagram,
    manual,
    linkUrl: link?.url ?? null,
    linkTitle: link?.title ?? null,
  };
}

export async function scheduleMetaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const item = await parseForm(formData, back);
  try {
    await insertReel(item);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-meta] schedule: ${String(err).slice(0, 200)}`);
    back("failed");
  }
  back(`scheduled-${item.manual ? "manual" : item.kind}`);
}

export async function updateMetaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  // Problems go back to the edit form.
  const again = (s: string): never => back(s, `&edit=${id.data}#edit`);
  const item = await parseForm(formData, again);
  let saved = false;
  try {
    saved = await updateReel(id.data, item);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-meta] update: ${String(err).slice(0, 200)}`);
    again("failed");
  }
  back(saved ? "updated" : "not-editable");
}

export async function cancelMetaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  try {
    await cancelReel(id.data);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-meta] cancel: ${String(err).slice(0, 200)}`);
    back("failed");
  }
  back("cancelled");
}

export async function markPostedAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("invalid");
  try {
    await markManualPosted(id.data);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[admin-meta] posted: ${String(err).slice(0, 200)}`);
    back("failed");
  }
  back("posted");
}

// --- The owner's Telegram ------------------------------------------------------------------------

export async function telegramCodeAction(): Promise<void> {
  await requireAdmin();
  try {
    await newOwnerCode();
  } catch (err) {
    unstable_rethrow(err);
    back("failed");
  }
  back("tg-code", "#telegram");
}

export async function telegramConfirmAction(): Promise<void> {
  await requireAdmin();
  let result = "failed";
  try {
    result = await confirmOwnerCode();
  } catch (err) {
    unstable_rethrow(err);
  }
  back(`tg-${result}`, "#telegram");
}

export async function telegramUnlinkAction(): Promise<void> {
  await requireAdmin();
  try {
    await unlinkOwner();
  } catch (err) {
    unstable_rethrow(err);
    back("failed");
  }
  back("tg-unlinked", "#telegram");
}
