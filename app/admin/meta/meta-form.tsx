"use client";

// New scheduled content for the Facebook Page and its Instagram account (owner requests
// 2026-10-24): a feed post (1-10 images: one image, or a carousel / multi-photo post), a story (one
// image or one video) or a Reel (one video). Files go straight from the browser (or the phone) to
// the private bucket through signed upload URLs (never through Vercel, whose request limit is
// 4.5 MB). Images are turned into JPEG here first (Instagram takes JPEG only): at most 1440 px wide
// for a post (1080x1920 for a story), and a post image outside Instagram's 4:5 to 1.91:1 is padded
// with white to the nearest allowed ratio, so Instagram never rejects it.
import { createClient } from "@supabase/supabase-js";
import { CalendarClock, Film, Image as ImageIcon, Images, Upload, X } from "lucide-react";
import { useId, useState } from "react";
import { btnBusy, btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { inputClass } from "../settings/form-parts";
import { metaUploadAction, scheduleMetaAction } from "./actions";

type Kind = "post" | "story" | "reel";

/** The bucket's limit (the Supabase free plan's most for one file). */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const MAX_POST_IMAGES = 10;
/** Instagram's feed ratios (width / height). */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;

const KINDS: { kind: Kind; label: string; icon: typeof Images; hint: string }[] = [
  { kind: "post", label: "פוסט", icon: Images, hint: "תמונה אחת או עד 10 (קרוסלה)" },
  { kind: "story", label: "סטורי", icon: ImageIcon, hint: "תמונה או סרטון, נעלם אחרי 24 שעות" },
  { kind: "reel", label: "רילז", icon: Film, hint: "סרטון אנכי 9:16" },
];

interface Uploaded {
  path: string;
  type: "image" | "video";
  preview: string;
  note?: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = URL.createObjectURL(file);
  });
}

/** The image as a JPEG for Meta, and a note when it was padded. */
async function toJpeg(file: File, kind: Kind): Promise<{ blob: Blob; note?: string }> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let frameW = w;
  let frameH = h;
  let note: string | undefined;
  if (kind === "post") {
    const ratio = w / h;
    if (ratio < MIN_RATIO) {
      frameW = Math.round(h * MIN_RATIO);
      note = "התמונה גבוהה מ־4:5, אז הוספנו לה שוליים לבנים בצדדים (אינסטגרם דוחה צרה יותר).";
    } else if (ratio > MAX_RATIO) {
      frameH = Math.round(w / MAX_RATIO);
      note = "התמונה רחבה מ־1.91:1, אז הוספנו לה שוליים לבנים למעלה ולמטה.";
    }
  }
  const maxW = kind === "post" ? 1440 : 1080;
  const maxH = kind === "post" ? 1800 : 1920;
  const scale = Math.min(1, maxW / frameW, maxH / frameH);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frameW * scale);
  canvas.height = Math.round(frameH * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("encode");
  return { blob, note };
}

function videoSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

async function uploadFile(target: "reel" | "image" | "video", body: Blob): Promise<string> {
  const signed = await metaUploadAction(target);
  if (!signed) throw new Error("no upload url");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { error } = await supabase.storage
    .from("agent-media")
    .uploadToSignedUrl(signed.path, signed.token, body, {
      contentType: target === "image" ? "image/jpeg" : "video/mp4",
    });
  if (error) throw error;
  return signed.path;
}

export function MetaForm({ defaultWhen, minWhen }: { defaultWhen: string; minWhen: string }) {
  const ids = { file: useId(), caption: useId(), when: useId() };
  const [kind, setKind] = useState<Kind>("post");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captionLength, setCaptionLength] = useState(0);

  const limit = kind === "post" ? MAX_POST_IMAGES : 1;
  const accept =
    kind === "post"
      ? "image/*"
      : kind === "story"
        ? "image/*,video/mp4,video/quicktime"
        : "video/mp4,video/quicktime";

  function choose(next: Kind) {
    if (next === kind) return;
    files.forEach((f) => URL.revokeObjectURL(f.preview));
    setFiles([]);
    setError(null);
    setKind(next);
  }

  async function add(list: File[]) {
    setError(null);
    const room = limit - (kind === "post" ? files.length : 0);
    if (list.length > room) {
      setError(kind === "post" ? `אפשר עד ${MAX_POST_IMAGES} תמונות בפוסט.` : "רק קובץ אחד.");
      list = list.slice(0, Math.max(room, 0));
    }
    setBusy(true);
    try {
      const done: Uploaded[] = [];
      for (const file of list) {
        const isVideo = file.type.startsWith("video/");
        if (isVideo) {
          if (!VIDEO_TYPES.includes(file.type)) throw new Error("רק סרטון MP4 או MOV.");
          if (file.size > MAX_VIDEO_BYTES) {
            throw new Error(
              `הסרטון ${(file.size / 1024 / 1024).toFixed(0)}MB, והמקסימום 50MB. כווצו אותו (למשל ייצוא ב־1080p) ונסו שוב.`,
            );
          }
          const seconds = await videoSeconds(file);
          const max = kind === "story" ? 60 : 90;
          let note: string | undefined;
          if (seconds !== null && (seconds < 3 || seconds > max)) {
            note = `הסרטון ${Math.round(seconds)} שניות, ו־Meta מקבלת ${kind === "story" ? "סטורי" : "רילז"} של 3 עד ${max} שניות.`;
          }
          const path = await uploadFile(kind === "reel" ? "reel" : "video", file);
          done.push({ path, type: "video", preview: URL.createObjectURL(file), note });
        } else {
          if (!file.type.startsWith("image/")) throw new Error("רק תמונות (JPG, PNG, WebP).");
          let jpeg: { blob: Blob; note?: string };
          try {
            jpeg = await toJpeg(file, kind);
          } catch {
            throw new Error("לא הצלחנו לקרוא את התמונה. נסו JPG או PNG.");
          }
          const path = await uploadFile("image", jpeg.blob);
          done.push({
            path,
            type: "image",
            preview: URL.createObjectURL(jpeg.blob),
            note: jpeg.note,
          });
        }
      }
      setFiles((old) => {
        if (kind !== "post") old.forEach((f) => URL.revokeObjectURL(f.preview));
        return kind === "post" ? [...old, ...done] : done;
      });
    } catch (err) {
      setError(
        err instanceof Error && /[א-ת]/.test(err.message) ? err.message : "ההעלאה נכשלה. נסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  }

  function remove(path: string) {
    setFiles((old) => {
      const gone = old.find((f) => f.path === path);
      if (gone) URL.revokeObjectURL(gone.preview);
      return old.filter((f) => f.path !== path);
    });
  }

  const media = kind === "reel" ? [] : files.map(({ path, type }) => ({ path, type }));
  const videoPath = kind === "reel" ? (files[0]?.path ?? "") : "";
  const ready = files.length > 0 && !busy;
  const label = KINDS.find((k) => k.kind === kind)!.label;

  return (
    <form action={scheduleMetaAction} className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="pb-2 font-semibold">1. מה מפרסמים</legend>
        <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-surface-2 p-1">
          {KINDS.map((k) => {
            const Icon = k.icon;
            const on = k.kind === kind;
            return (
              <label
                key={k.kind}
                className={`flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent ${
                  on
                    ? "bg-surface font-bold text-accent-ink shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                    : "font-semibold text-muted hover:text-ink"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={k.kind}
                  checked={on}
                  onChange={() => choose(k.kind)}
                  className="sr-only"
                />
                <span className="flex items-center gap-1.5">
                  <Icon aria-hidden className="size-[18px]" />
                  {k.label}
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted">{KINDS.find((k) => k.kind === kind)!.hint}</p>
      </fieldset>

      <div className="space-y-2">
        <p className="font-semibold">
          2. {kind === "post" ? "התמונות" : kind === "story" ? "התמונה או הסרטון" : "הסרטון"}
        </p>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-3">
            {files.map((f, i) => (
              <li key={f.path} className="relative">
                {f.type === "video" ? (
                  <video
                    src={f.preview}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-56 rounded-lg border border-line bg-black"
                  />
                ) : (
                  // A local blob preview: next/image does not apply.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.preview}
                    alt={`תמונה ${i + 1}`}
                    className={`rounded-lg border border-line bg-surface-2 object-contain ${kind === "story" ? "h-56" : "size-32"}`}
                  />
                )}
                {kind === "post" && files.length > 1 && (
                  <span className="absolute top-1.5 start-1.5 grid size-6 place-items-center rounded-full bg-ink text-xs font-bold text-invert-ink">
                    {i + 1}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`הסרת ${f.type === "video" ? "הסרטון" : `תמונה ${i + 1}`}`}
                  onClick={() => remove(f.path)}
                  className="absolute top-1 end-1 grid size-8 place-items-center rounded-full bg-surface/90 text-ink shadow hover:bg-surface"
                >
                  <X aria-hidden className="size-4" />
                </button>
                {f.note && <p className="mt-1 max-w-56 text-xs text-muted">{f.note}</p>}
              </li>
            ))}
          </ul>
        )}
        {files.length < limit && (
          <div className="space-y-1.5">
            <label
              htmlFor={ids.file}
              aria-disabled={busy}
              className={`${btnSecondary} ${btnMd} ${btnBusy} cursor-pointer gap-2`}
            >
              <Upload aria-hidden className="size-[18px]" />
              {busy
                ? "מעלה…"
                : kind === "post"
                  ? files.length
                    ? "הוספת תמונות"
                    : "בחירת תמונות"
                  : kind === "story"
                    ? "בחירת תמונה או סרטון"
                    : "בחירת סרטון"}
            </label>
            <input
              id={ids.file}
              type="file"
              accept={accept}
              multiple={kind === "post"}
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (list.length) void add(list);
              }}
            />
            <p className="text-xs text-muted">
              {kind === "post"
                ? "JPG, PNG או WebP, עד 10. מומלץ מרובע (1080×1080) או 4:5 (1080×1350). הסדר בקרוסלה כסדר הבחירה."
                : kind === "story"
                  ? "אנכי 9:16 (1080×1920). סרטון MP4 או MOV עד 50MB, 3 עד 60 שניות."
                  : "MP4 או MOV עד 50MB, אנכי 9:16 (1080×1920), 3 עד 90 שניות."}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm font-semibold text-ink">
            {error}
          </p>
        )}
        <input type="hidden" name="videoPath" value={videoPath} />
        <input type="hidden" name="media" value={JSON.stringify(media)} />
      </div>

      {kind === "story" ? (
        <p className="text-sm text-muted">
          לסטורי אין כיתוב ב־API של Meta: כתבו את הטקסט על התמונה עצמה. קישור בסטורי (מדבקת קישור)
          אפשר להוסיף רק מהאפליקציה.
        </p>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={ids.caption} className="font-semibold">
            3. הכיתוב
          </label>
          <textarea
            id={ids.caption}
            name="caption"
            rows={7}
            maxLength={2100}
            required
            onChange={(e) => setCaptionLength(e.target.value.length)}
            className={`${inputClass} leading-relaxed`}
          />
          <p className="text-xs text-muted">
            <bdi dir="ltr">{captionLength}</bdi>/2100. באינסטגרם קישור בכיתוב לא לחיץ: כתבו ״הקישור
            בפרופיל״.
          </p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="disclosure"
              defaultChecked
              className="size-5 accent-[var(--accent)]"
            />
            להוסיף בסוף את גילוי השותפים (כשה{label} מקדם מוצר מאלי אקספרס)
          </label>
        </div>
      )}

      <fieldset className="space-y-1.5">
        <legend className="font-semibold">{kind === "story" ? "3" : "4"}. איפה לפרסם</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="instagram"
              defaultChecked
              className="size-5 accent-[var(--accent)]"
            />
            אינסטגרם
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="facebook"
              defaultChecked
              className="size-5 accent-[var(--accent)]"
            />
            פייסבוק
          </label>
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor={ids.when} className="font-semibold">
          {kind === "story" ? "4" : "5"}. מתי (שעון ישראל)
        </label>
        <input
          id={ids.when}
          type="datetime-local"
          name="when"
          required
          defaultValue={defaultWhen}
          min={minWhen}
          className={`${inputClass} max-w-xs`}
        />
        <p className="text-xs text-muted">
          לפחות 20 דקות מעכשיו, לא בשישי מ־17:00 עד שבת 19:30. המערכת מכינה את התוכן אצל Meta עד שעה
          לפני, ומפרסמת בזמן (בדיקה כל 15 דקות).
        </p>
      </div>

      <button
        type="submit"
        aria-disabled={!ready}
        disabled={!ready}
        className={`${btnPrimary} ${btnMd} ${btnBusy} gap-2`}
      >
        <CalendarClock aria-hidden className="size-[18px]" />
        תזמון ה{label}
      </button>
    </form>
  );
}
